'use strict';
const OpenAI = require("openai");
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

module.exports = function(Openai) {
    // Check JSON validation
    const isValidJSON = async (str) => {
        try {
          JSON.parse(str);
          return true;
        } catch (e) {
          return false;
        }
    };

    // The below function is not in use and purely kept for backup in case the old functionality needs to be reverted back
    // It can be deleted in future in case the latest functionality gets accepted by the client
    async function returnOpenAIResponseOld(prompt) {
        try {
            // Initializing OpenAI
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });

            return await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL_KEY,
                messages: [{
                    "role": "user",
                    content: prompt
                },{
                    "role": "system",
                    content: "each suggestion MUST be within 35 characters"
                }],
                temperature: 1,
                max_tokens: 4096,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
            });
        } catch(err) {
            console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
            err.message = "Oops! something went wrong! Try again.";
            throw(err);
        }
    }

    function tryFixMalformedJson(text) {
  // Try simple extract from `{` to `}` first
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
  
        let candidate = match[0];

        // Try parsing directly first
        try {
          return JSON.parse(candidate);
        } catch (e) {
          // Start trimming from the end
          for (let i = 1; i <= 5; i++) {
            let trimmed = candidate.slice(0, -i);
            try {
              return JSON.parse(trimmed);
            } catch (e) {
              continue;
            }
          }
        }

        return null;
    }



    async function returnOpenAIResponse(prompt, threadId, byPhase=null) {
        try {
            if (!byPhase){
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

                             Do NOT return a list of goals. The root must always be an object of type "GOAL". and every node at-least have two child, No markdown, no explanation, only pure JSON.`
            }
            await openai.beta.threads.messages.create(threadId, {
                    role: "user",
                    content: prompt
                }
            );
            let run = await openai.beta.threads.runs.createAndPoll(threadId, { 
                    assistant_id: process.env.OPENAI_ASSISTANT_KEY
                }
            );
            if (run.status === 'completed') {
                const messages = await openai.beta.threads.messages.list(run.thread_id);
                const validString = messages.data[0].content[0].text.value;
                return validString;
            } else {
                let error = new Error("Oops! something went wrong! Try again.");
                error.status = 400;
                throw error;
            }
        } catch(err) {
            console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
            err.message = "Oops! something went wrong! Try again.";
            throw(err);
        }
    }

    // Nodes name suggestions based on prompt given by user
    Openai.suggestGoalNamesByUser = async (prompt, type, kartaId) => {
        try {
            // Preparing prompt
            console.log("We are coming here")
            type = type || "";
            prompt = prompt || "I'm working in marketing department in IT industry. Suggest me some GOALs";
            let thread = "";
            let kartaDetails = await Openai.app.models.karta.findById(kartaId);
            // JSON.parse(JSON.stringify(kartaDetails));
            if (kartaDetails.threadId) {
                thread = kartaDetails.threadId
            } else {
                let newThread = await openai.beta.threads.create();
                thread = newThread.id;
                await Openai.app.models.karta.update({ "id": kartaId }, { $set: { threadId: thread }} );
            }
            
            let response = null;
            let result = null;
            let validFlag = 0;
            while(validFlag < 5) {
                response = await returnOpenAIResponse(prompt, thread);
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
                if(result && result.message) {
                    // let error = new Error(result.message);
                    let error = new Error("Oops! something went wrong! Try again.");
                    error.status = 400;
                    throw error;
                } else {
                    // Converting and sending response to Frontend
                    let nodeValues = result.data.map(name => {
                        return { name, type: "auto", title: name };
                    });
                    nodeValues.push({type: "manual"});
                    return nodeValues;
                }
            }
        } catch(err) {
            // Handling Catch Error
            console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY USER PROMPT");
            err.message = "Oops! something went wrong! Try again.";
            throw(err);
        }
    }

    // The below function is not in use and purely kept for backup in case the old functionality needs to be reverted back
    // It can be deleted in future in case the latest functionality gets accepted by the client
    // Nodes name suggestions based on phase layer
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
            while(validFlag < 5) {
                response = await returnOpenAIResponse(content);
                let validJson = await isValidJSON(response.choices[0].message.content);
                if (validJson) {
                    result = JSON.parse(response.choices[0].message.content);
                    validFlag = 5;
                } else {
                    validFlag += 1;
                }
            }

            // Error Handling
            if(result?.message) {
                // let error = new Error("Unable to fetch result. Please try again..!!");
                let error = new Error("Oops! something went wrong! Try again.");
                error.status = 400;
                throw error;
            } else {
                // Converting and sending response to Frontend
                if(Array.isArray(result)) {
                    let nodeValues = result.map(name => {
                        return { name, type: "auto"};
                    });
                    nodeValues.push({type: "manual"});
                    return nodeValues;
                } else {
                    // let error = new Error("Unable to fetch result. Please try again..!!");
                    console.log(result, "<----------- Not an expected Array");
                    let error = new Error("Oops! something went wrong! Try again.");
                    error.status = 400;
                    throw error;
                }
            }
        } catch(err) {
            // Handling Catch Error
            console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
            err.message = "Oops! something went wrong! Try again.";
            throw(err);
        }
    }

    // Nodes name suggestions based on phase layer
    Openai.suggestGoalNamesByPhase = async (prompt, kartaId) => {
        try {
            console.log('by phase')
            let thread = "";
            let kartaDetails = await Openai.app.models.karta.findById(kartaId);
            JSON.parse(JSON.stringify(kartaDetails));
            if (kartaDetails.threadId) {
                thread = kartaDetails.threadId
            } else {
                let newThread = await openai.beta.threads.create();
                thread = newThread.id;
                await Openai.app.models.karta.update({ "id": kartaId }, { $set: { threadId: thread }} );
            }
            let response = await returnOpenAIResponse(prompt, thread, true);
            if(Array.isArray(JSON.parse(response)?.data)) {
                let nodeValues = JSON.parse(response).data.map(name => {
                    return { name, type: "auto" };
                });
                nodeValues.push({ type: "manual" });
                return nodeValues;
            } else {
                let error = new Error("Oops! something went wrong! Try again.");
                error.status = 400;
                throw error;
            }
        } catch(err) {
            // Handling Catch Error
            console.log(err, "OPENAI -> ERROR WHILE GENERATING SUGGESTIONS BY PHASE");
            err.message = "Oops! something went wrong! Try again.";
            throw(err);
        }
    }
};