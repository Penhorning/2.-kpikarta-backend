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

// Fine-tuned models built on retired bases (e.g. ft:gpt-3.5-turbo-1106:*)
// now answer 404 model_not_found. When that happens we transparently move
// to a current general model and remember it for the rest of the process.
const DEFAULT_FALLBACK_MODEL = "gpt-4.1-mini";
let resolvedModel = null;

function configuredModel() {
  return process.env.OPENAI_MODEL_KEY || process.env.OPENAI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
}

function fallbackModel() {
  return process.env.OPENAI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
}

function currentModel() {
  return resolvedModel || configuredModel();
}

function isModelGoneError(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || "").toLowerCase();
  return code === "model_not_found" || code === "model_deprecated" ||
    msg.includes("has been deprecated") ||
    (msg.includes("model") && (msg.includes("does not exist") || msg.includes("not found")));
}

const LAYERS = "GOAL, CSF (Critical Success Factor), PHASE, SEGMENT, APPROACH, ACTION, KPI";

const LIST_SYSTEM_PROMPT =
  "You are the KPI Karta suggestion engine. " +
  `The Karta tree layers are ${LAYERS}. ` +
  "The user gives business context and asks for suggestions for exactly one layer. " +
  "Return 4 to 6 concise, specific names for that layer. " +
  "Each name must be a short noun phrase (max 70 characters). " +
  "Do not repeat the layer name in every suggestion. No explanations.";

const TREE_SYSTEM_PROMPT =
  "You are the KPI Karta strategy engine. Build one complete Karta strategy tree. " +
  "Structure: GOAL root -> CSF -> PHASE -> SEGMENT -> APPROACH -> ACTION -> KPI leaf names. " +
  "PHASE nodes are typically Acquire, Engage, Convert, Retain. " +
  "Use the user's industry and department context. " +
  "Every non-leaf node must have at least two children. " +
  "Names must be concise (max 70 characters). No explanations.";

// JSON schema for a flat suggestion list (strict structured output).
const LIST_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "name_list",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["data"],
      properties: {
        data: {
          type: "array",
          minItems: 4,
          maxItems: 6,
          items: { type: "string" },
        },
      },
    },
  },
};

// JSON schema for a full Karta tree with fixed depth (strict structured output).
function treeResponseFormat() {
  const levels = ["GOAL", "CSF", "PHASE", "SEGMENT", "APPROACH", "ACTION"];
  const node = (i) => ({
    type: "object",
    additionalProperties: false,
    required: ["type", "name", "children"],
    properties: {
      type: { type: "string", enum: [levels[i]] },
      name: { type: "string" },
      children: i === levels.length - 1
        ? { type: "array", minItems: 2, items: { type: "string" } }
        : { type: "array", minItems: 2, items: node(i + 1) },
    },
  });
  return {
    type: "json_schema",
    json_schema: { name: "karta_tree", strict: true, schema: node(0) },
  };
}

module.exports = function (Openai) {
  function toServiceError(err) {
    if (err && err.status === 404 && err.message === "Karta not found.") return err;
    if (err && err.status === 400) {
      const error = new Error(err.message || "Oops! something went wrong! Try again.");
      error.status = 400;
      return error;
    }
    const error = new Error("Oops! something went wrong! Try again.");
    error.status = err && err.status === 404 ? 502 : 502;
    error.cause = err;
    return error;
  }

  async function loadKartaContext(kartaId) {
    const kartaDetails = await Openai.app.models.karta.findById(kartaId);
    if (!kartaDetails) {
      throw Object.assign(new Error("Karta not found."), { status: 404 });
    }
    return kartaDetails;
  }

  // Single chat call with structured output. Retries once on a deprecated
  // model by switching to the fallback model, and once on any transient
  // API failure.
  async function callStructured({ prompt, system, responseFormat, maxTokens, attempt = 0 }) {
    const client = getClient();
    const model = currentModel();
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: responseFormat,
        max_completion_tokens: maxTokens,
      });
      const text = completion.choices && completion.choices[0] &&
        completion.choices[0].message && completion.choices[0].message.content;
      if (!text) throw new Error("Empty response from OpenAI");
      return JSON.parse(text);
    } catch (err) {
      if (isModelGoneError(err) && attempt === 0) {
        const fallback = fallbackModel();
        if (model !== fallback) {
          console.warn(`OpenAI model "${model}" is unavailable (${err.code || err.message}). ` +
            `Switching to "${fallback}". Update OPENAI_MODEL_KEY to silence this.`);
          resolvedModel = fallback;
          return callStructured({ prompt, system, responseFormat, maxTokens, attempt: attempt + 1 });
        }
      }
      throw err;
    }
  }

  async function generateNames(prompt) {
    const parsed = await callStructured({
      prompt,
      system: LIST_SYSTEM_PROMPT,
      responseFormat: LIST_RESPONSE_FORMAT,
      maxTokens: 500,
    });
    const names = parsed && Array.isArray(parsed.data)
      ? parsed.data.filter((n) => typeof n === "string" && n.trim())
      : [];
    if (!names.length) {
      throw Object.assign(new Error("No suggestions returned."), { status: 502 });
    }
    return names;
  }

  async function generateTree(prompt) {
    const parsed = await callStructured({
      prompt,
      system: TREE_SYSTEM_PROMPT,
      responseFormat: treeResponseFormat(),
      maxTokens: 4000,
    });
    if (!parsed || parsed.type !== "GOAL" || !Array.isArray(parsed.children) || !parsed.children.length) {
      throw Object.assign(new Error("Invalid tree from OpenAI."), { status: 502 });
    }
    return parsed;
  }

  // Suggestions for the current Karta layer based on the user's own prompt.
  // type === "button" (I'm feeling lucky) builds a full tree; otherwise it
  // returns name chips for the layer the prompt asks about.
  Openai.suggestGoalNamesByUser = async (prompt, type, kartaId) => {
    try {
      type = type || "";
      prompt = prompt || "I'm working in marketing department in IT industry. Suggest me some GOALs";
      await loadKartaContext(kartaId);

      if (type === "button") {
        return await generateTree(prompt);
      }

      const names = await generateNames(prompt);
      const nodeValues = names.map((name) => ({ name, type: "auto", title: name }));
      nodeValues.push({ type: "manual" });
      return nodeValues;
    } catch (err) {
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY USER PROMPT");
      throw toServiceError(err);
    }
  };

  // Legacy helper kept for backup; returns plain name chips.
  Openai.suggestGoalNamesByPhase2 = async (industry, department, phase, prompt) => {
    try {
      if (phase === "Critical Success Factor" || phase === "Critical") phase = "CSF";
      const content = `I'm working in ${department} department in ${industry} industry. Suggest me some ${phase}s. ${prompt || ""}`.trim();
      const names = await generateNames(content);
      const nodeValues = names.map((name) => ({ name, type: "auto" }));
      nodeValues.push({ type: "manual" });
      return nodeValues;
    } catch (err) {
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
      throw toServiceError(err);
    }
  };

  // Suggestions for the layer the frontend is currently editing.
  Openai.suggestGoalNamesByPhase = async (prompt, kartaId) => {
    try {
      await loadKartaContext(kartaId);
      const names = await generateNames(prompt);
      const nodeValues = names.map((name) => ({ name, type: "auto" }));
      nodeValues.push({ type: "manual" });
      return nodeValues;
    } catch (err) {
      console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
      throw toServiceError(err);
    }
  };
};
