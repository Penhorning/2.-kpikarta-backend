'use strict';
const OpenAI = require("openai");

// Lazy client so LoopBack boot doesn't crash when the key is missing and
// dotenv load order varies. Validates on first use with a clear message.
let openaiClient = null;
function getClient() {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("AI service is not configured. Missing OPENAI_API_KEY.");
    error.status = 500;
    throw error;
  }
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function getModel() {
  return process.env.OPENAI_MODEL_KEY || "gpt-4o-mini";
}

// Optional override; lets the client paste the old Assistant's instructions
// into an env var later without a code change.
function getInstructions() {
  return process.env.OPENAI_INSTRUCTIONS ||
    "You are the KPI Karta suggestion assistant. " +
    "Respond ONLY with pure JSON, no markdown, no explanation, no code fences.";
}

module.exports = function (Openai) {
  // Check JSON validation
  const isValidJSON = async (str) => {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  };

  function tryFixMalformedJson(text) {
    if (!text || typeof text !== "string") return null;
    // Try parsing the whole text first (covers bare arrays too)
    try {
      return deepUnwrapJson(JSON.parse(text));
    } catch (e) { /* fall through to extraction */ }
    // Try simple extract from `{` to `}` or `[` to `]` first
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;

    let candidate = match[0];

    // Try parsing directly first
    try {
      return deepUnwrapJson(JSON.parse(candidate));
    } catch (e) {
      // Start trimming from the end
      for (let i = 1; i <= 5; i++) {
        let trimmed = candidate.slice(0, -i);
        try {
          return deepUnwrapJson(JSON.parse(trimmed));
        } catch (e) {
          continue;
        }
      }
    }

    return null;
  }

  // Unwrap double-encoded payloads, e.g. '["{...escaped tree...}"]'
  // -> the inner object. Recurses up to 3 levels.
  function deepUnwrapJson(parsed) {
    let current = parsed;
    for (let i = 0; i < 3; i++) {
      if (Array.isArray(current) && current.length === 1 && typeof current[0] === "string") {
        try {
          current = JSON.parse(current[0]);
          continue;
        } catch (e) { break; }
      }
      if (current && typeof current === "object" && typeof current.data === "string") {
        try {
          current = JSON.parse(current.data);
          continue;
        } catch (e) { break; }
      }
      break;
    }
    return current;
  }

  // Extract plain text from a Responses API response object.
  function extractResponsesText(response) {
    if (!response) return "";
    if (typeof response.output_text === "string" && response.output_text) {
      return response.output_text;
    }
    const chunks = [];
    for (const item of response.output || []) {
      if (item.type === "message") {
        for (const part of item.content || []) {
          if (part.type === "output_text" && part.text) chunks.push(part.text);
        }
      }
    }
    return chunks.join("");
  }

  function isModelUnsupportedError(err) {
    const status = err && err.status;
    const msg = String((err && err.message) || "").toLowerCase();
    return status === 400 || status === 404 ||
      msg.includes("model") && (msg.includes("not found") || msg.includes("does not exist") || msg.includes("unsupported"));
  }

  // Bare chat call for phase suggestions: NO system prompt, NO appended
  // instructions, NO response_format. Probing proved the fine-tuned model
  // natively returns ["name", ...] arrays for bare KPI prompts, and every
  // added instruction degrades it (trees, guardrail refusals).
  async function createBareChatSuggestion(prompt) {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
      max_tokens: 4096,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    const text = completion.choices && completion.choices[0] &&
      completion.choices[0].message && completion.choices[0].message.content;
    return text || "";
  }

  // Primary path for user-chat: Responses API (official Assistants
  // successor), falling back to Chat Completions so fine-tuned chat models
  // keep working even if they don't support Responses.
  async function createModelResponse({ prompt, instructions, previousResponseId }) {
    const client = getClient();
    const model = getModel();
    try {
      const payload = {
        model,
        instructions,
        input: prompt,
        text: { format: { type: "json_object" } },
      };
      if (previousResponseId) payload.previous_response_id = previousResponseId;
      const response = await client.responses.create(payload);
      return { text: extractResponsesText(response), responseId: response.id || null, via: "responses" };
    } catch (err) {
      if (!isModelUnsupportedError(err)) throw err;
      console.warn("Responses API unavailable for model, falling back to Chat Completions:", err.message);
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 1,
        max_tokens: 4096,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });
      const text = completion.choices && completion.choices[0] &&
        completion.choices[0].message && completion.choices[0].message.content;
      return { text: text || "", responseId: null, via: "chat.completions" };
    }
  }

  // Replacement for the retired Assistants threads/runs helper.
  // byPhase calls are stateless single-shots: chaining previous_response_id
  // drags stale GOAL-tree context that makes the fine-tuned model ignore
  // the {"data"} format. User-chat calls keep per-karta continuity.
  // Returns the raw model output string.
  async function returnOpenAIResponse(prompt, kartaId, byPhase = null) {
    if (byPhase) {
      prompt += ` Respond ONLY with a single JSON object with this structure:
                              { "data": ["suggestion 1", "suggestion 2", "suggestion 3", "suggestion 4", ...] }
                              Give at least 4 suggestions.
                              No markdown, no explanation, only pure JSON.`;
    } else {
      prompt += `Respond ONLY with a single JSON object with this structure:

                             {
                               "type": "GOAL",
                               "name": "...",
                               "children": [
                                 {
                                   "type": "CSF",
                                   "name": "...",
                                   "children": [ ... ]
                                 }
                               ]
                             }

                             Do NOT return a list of goals. The root must always be an object of type "GOAL". and every node at-least have two child, No markdown, no explanation, only pure JSON.`;
    }
    try {
      // Stateless for byPhase: never chain or persist response ids, so a
      // previous GOAL-tree generation can't leak into a name-list request.
      const stateless = !!byPhase;
      const context = !stateless && kartaId ? await loadKartaContext(kartaId) : { previousResponseId: null };
      const result = await createModelResponse({
        prompt,
        instructions: getInstructions(),
        previousResponseId: context.previousResponseId,
      });
      if (kartaId && !stateless && result.responseId) {
        await saveKartaContext(kartaId, result.responseId).catch((e) => {
          console.warn("Could not persist openaiResponseId for karta", kartaId, e.message);
        });
      }
      if (!result.text) {
        throw Object.assign(new Error("Oops! something went wrong! Try again."), { status: 502 });
      }
      return result.text;
    } catch (err) {
      console.error("OPENAI -> ERROR WHILE GENERATING SUGGESTIONS:", err.message, err.response?.data || err);
      throw toServiceError(err);
    }
  }

  // Load per-karta Responses chaining state. Legacy `threadId` values from
  // the retired Assistants API are ignored (they 404 since Aug 26, 2026).
  async function loadKartaContext(kartaId) {
    const kartaDetails = await Openai.app.models.karta.findById(kartaId);
    if (!kartaDetails) {
      throw Object.assign(new Error("Karta not found."), { status: 404 });
    }
    const plain = typeof kartaDetails.toJSON === "function" ? kartaDetails.toJSON() : kartaDetails;
    return { previousResponseId: plain.openaiResponseId || null };
  }

  async function saveKartaContext(kartaId, responseId) {
    await Openai.app.models.karta.update(
      { id: kartaId },
      { $set: { openaiResponseId: responseId } }
    );
  }

  // Never forward the raw OpenAI status (e.g. its 404) to API consumers;
  // that made it look like our own route was missing.
  function toServiceError(err) {
    if (err && (err.status === 404 && err.message === "Karta not found.")) return err;
    if (err && err.status === 400) {
      const error = new Error(err.message || "Oops! something went wrong! Try again.");
      error.status = 400;
      return error;
    }
    const error = new Error("Oops! something went wrong! Try again.");
    error.status = 502;
    error.cause = err;
    return error;
  }

  // Nodes name suggestions based on prompt given by user
  Openai.suggestGoalNamesByUser = async (prompt, type, kartaId) => {
    try {
      // Preparing prompt
      type = type || "";
      prompt = prompt || "I'm working in marketing department in IT industry. Suggest me some GOALs";
      await loadKartaContext(kartaId); // validates karta exists -> 404 "Karta not found."

      let response = null;
      let result = null;
      let validFlag = 0;
      while (validFlag < 5) {
        response = await returnOpenAIResponse(prompt, kartaId);
        console.log("RESPONSE FROM OPENAI", response);
        let validJson = tryFixMalformedJson(response);
        if (validJson) {
          result = validJson;
          validFlag = 5;
        } else {
          console.log("Invalid JSON response from OpenAI");
          validFlag += 1;
        }
      }

      if (type == "button") {
        // RESULT GIVEN FOR I'M FEELING LUCKY
        return result;
      } else {
        // RESULT GIVEN FOR USER CHAT PROMPT
        if (result && result.message) {
          let error = new Error("Oops! something went wrong! Try again.");
          error.status = 400;
          throw error;
        } else {
          // Converting and sending response to Frontend
          const names = extractNameList(result);
          if (!names) {
            console.log(result, "<----------- Not an expected name list");
            let error = new Error("Oops! something went wrong! Try again.");
            error.status = 502;
            throw error;
          }
          let nodeValues = names.map(name => {
            return { name, type: "auto", title: name };
          });
          nodeValues.push({ type: "manual" });
          return nodeValues;
        }
      }
    } catch (err) {
      // Handling Catch Error
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY USER PROMPT");
      throw toServiceError(err);
    }
  };

  // Nodes name suggestions based on phase layer (legacy Chat Completions
  // backup, kept in case the Responses API needs to be bypassed).
  Openai.suggestGoalNamesByPhase2 = async (industry, department, phase, prompt) => {
    try {
      // Preparing prompt
      if (phase === "Critical Success Factor" || phase === "Critical") {
        phase = "CSF"
      }
      let content = `I'm working in ${department} department in ${industry} industry. Suggest me some ${phase}s`;
      console.log("prompt ----------------->", prompt);

      let response = null;
      let result = null;
      let validFlag = 0;
      while (validFlag < 5) {
        response = await createModelResponse({
          prompt: content,
          instructions: getInstructions(),
          previousResponseId: null,
        });
        let validJson = await isValidJSON(response.text);
        if (validJson) {
          result = JSON.parse(response.text);
          validFlag = 5;
        } else {
          validFlag += 1;
        }
      }

      // Error Handling
      if (result?.message) {
        let error = new Error("Oops! something went wrong! Try again.");
        error.status = 400;
        throw error;
      } else {
        // Converting and sending response to Frontend
        if (Array.isArray(result)) {
          let nodeValues = result.map(name => {
            return { name, type: "auto" };
          });
          nodeValues.push({ type: "manual" });
          return nodeValues;
        } else {
          console.log(result, "<----------- Not an expected Array");
          let error = new Error("Oops! something went wrong! Try again.");
          error.status = 400;
          throw error;
        }
      }
    } catch (err) {
      // Handling Catch Error
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
      throw toServiceError(err);
    }
  };

  // Pull a string array out of the model output, tolerating shape drift
  // from the fine-tuned model (bare array, alternate keys, [{name}] items).
  function extractNameList(parsed) {
    if (!parsed) return null;
    const raw = Array.isArray(parsed) ? parsed :
      parsed.data || parsed.suggestions || parsed.names || parsed.results || null;
    if (!Array.isArray(raw)) return null;
    const names = raw.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.name === "string") return item.name;
      return null;
    }).filter(Boolean);
    return names.length ? names : null;
  }

  // Fallback: the fine-tuned model sometimes returns full GOAL/CSF trees
  // instead of a name list. Detect the requested node type from the prompt
  // (e.g. "suggest me appropriate sales phases") and collect those node
  // names across every tree in the output. If that level isn't present,
  // fall back to the trees' root names (the frontend labels chips with the
  // current level, so roots are safe suggestions).
  const TREE_TYPES = ["GOAL", "CSF", "PHASE", "SEGMENT", "APPROACH", "ACTION"];

  // Split text holding several concatenated JSON objects (plus possible
  // garbage bytes) into individually parsed objects. Brace-aware scan.
  function splitTopLevelObjects(text) {
    const out = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          try {
            out.push(JSON.parse(text.slice(start, i + 1)));
          } catch (e) { /* skip garbled chunk */ }
          start = -1;
        }
        if (depth < 0) depth = 0;
      }
    }
    return out;
  }

  function wantedTypes(prompt) {
    const upper = String(prompt || "").toUpperCase();
    let wanted = TREE_TYPES.filter((t) => upper.includes(t + "S") || upper.includes(t));
    // "Critical Success Factor" phrasing maps to CSF
    if (!wanted.length && /CRITICAL SUCCESS|CRITICAL/.test(upper)) wanted = ["CSF"];
    return wanted;
  }

  function walkTree(tree, wanted, names) {
    if (!tree || typeof tree !== "object") return; // bare strings are handled by extractNameList, never guessed as typed nodes
    if (tree.type && wanted.includes(String(tree.type).toUpperCase()) && tree.name) {
      names.push(tree.name);
    }
    const kids = Array.isArray(tree.children) ? tree.children : [];
    kids.forEach((k) => walkTree(k, wanted, names));
  }

  function extractNamesFromTree(tree, prompt) {
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
    if (!tree.children && !tree.data) return null;
    const wanted = wantedTypes(prompt);
    if (!wanted.length) {
      const kids = Array.isArray(tree.children) ? tree.children : [];
      const names = kids.map((k) => (k && k.name) || (typeof k === "string" ? k : null)).filter(Boolean);
      return names.length ? names : null;
    }
    const names = [];
    walkTree(tree, wanted, names);
    if (names.length) return names;
    // Requested level absent: the tree roots themselves are the suggestions
    if (tree.name) return [tree.name];
    return null;
  }

  // Multi-tree version: parse every concatenated object, gather typed names
  // across all of them, else gather every root name. Nested fragments that
  // are already contained in a bigger parsed tree are dropped.
  function extractNamesFromTrees(text, prompt) {
    const trees = splitTopLevelObjects(String(text || ""));
    if (!trees.length) return null;
    const serialized = trees.map((t) => JSON.stringify(t));
    const tops = trees.filter((t, i) => !serialized.some((s, j) =>
      j !== i && s.length > serialized[i].length && s.includes(serialized[i])));
    const wanted = wantedTypes(prompt);
    const names = [];
    tops.forEach((t) => walkTree(t, wanted, names));
    if (names.length) return names;
    const roots = tops.map((t) => t && t.name).filter((n) => typeof n === "string" && n);
    return roots.length ? roots.slice(0, 10) : null;
  }

  // Nodes name suggestions based on phase layer
  Openai.suggestGoalNamesByPhase = async (prompt, kartaId) => {
    try {
      console.log('by phase')
      console.log("PROMPT FOR OPENAI (by phase)", prompt);
      await loadKartaContext(kartaId); // validates karta exists -> 404 "Karta not found."
      let attempts = 0;
      let lastRaw = "";
      const seen = [];
      const pushUnique = (names) => {
        (names || []).forEach((n) => {
          if (typeof n === "string" && n.trim() && !seen.includes(n)) seen.push(n);
        });
      };
      // Accumulate unique names across attempts (each stateless call samples
      // a different output) until we have enough chips for the UI.
      // Bare prompts: sent verbatim, exactly like the pre-Assistants code did.
      while (attempts < 3 && seen.length < 4) {
        attempts += 1;
        let response = await createBareChatSuggestion(prompt);
        lastRaw = response;
        console.log("RESPONSE FROM OPENAI (by phase) attempt " + attempts + ":", response);
        const parsed = tryFixMalformedJson(response);
        const names = extractNameList(parsed) || extractNamesFromTree(parsed, prompt) ||
          extractNamesFromTrees(response, prompt);
        if (names) {
          pushUnique(names);
        } else {
          console.log("Unusable shape from OpenAI on attempt " + attempts + ", retrying...");
        }
      }
      if (seen.length) {
        let nodeValues = seen.slice(0, 10).map(name => {
          return { name, type: "auto" };
        });
        nodeValues.push({ type: "manual" });
        return nodeValues;
      }
      console.log(lastRaw, "<----------- Not an expected name list after retries");
      const error = new Error("Oops! something went wrong! Try again.");
      error.status = 502;
      throw error;
    } catch (err) {
      // Handling Catch Error
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
      if (err instanceof SyntaxError) {
        const error = new Error("Oops! something went wrong! Try again.");
        error.status = 502;
        throw error;
      }
      throw toServiceError(err);
    }
  };
};
