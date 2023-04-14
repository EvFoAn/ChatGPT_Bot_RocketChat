const { driver } = require('@rocket.chat/sdk');
const axios = require('axios');
const googleSearchBaseUrl = 'https://www.googleapis.com/customsearch/v1';
const SummarizerManager = require('node-summarizer').SummarizerManager;
const cheerio = require('cheerio');
const spinner = require('cli-spinners').dots;
const natural = require('natural');

const PromisePool = require('es6-promise-pool').PromisePool;

const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();
const openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
const ROCKETCHAT_URL = 'http://127.0.0.1:3000'; // or 'https://HOSTNAME';
const ROCKETCHAT_USER = 'NAME_BOT';
const ROCKETCHAT_PASSWORD = 'PASSWORD_BOT';
const rocketChatChannel = 'ROOM';
const OPENAI_API_KEY = 'API_KEY';

// Importing modules to indicate input
const cursor = require('cli-cursor');
const readline = require('readline');

// Setting up the Google API
const googleApiKey = 'API_KEY';
const customSearchEngineId = 'API_KEY';


const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendMessage(message, roomId) {
  try {
    await driver.sendToRoom(message, roomId, { typingIndicator: true });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

async function searchQuery(query) {
  try {
    const response = await axios.get(googleSearchBaseUrl, {
      params: {
        key: googleApiKey,
        cx: customSearchEngineId,
        q: query,
        num: 6,
        gl: 'ua,en',
        hl: 'ua,en,ru',
      },
    });
    return response.data.items;
  } catch (error) {
    console.error('Error in search query:', error);
    return null;
  }
}

async function sendResponse(responseBody, roomId) {

  if (
    responseBody.hasOwnProperty("choices") &&
    responseBody.choices.length > 0
  ) {
    varAnswer = responseBody.choices[0].message.content;
    const AiAnswer = varAnswer.replace(/```/g, "`");
    const wrappedText = "```\n" + AiAnswer + "\n```";

    const aiReply = wrappedText;
    lastResponse = aiReply;
    await sendMessage(aiReply, roomId);

    // Save the bots response to previousMessages
    previousMessages.push(aiReply);
    if (previousMessages.length > 4) {
      previousMessages.shift();
    }
  } else {
    console.error("Invalid response from OpenAI API");
  }
}


async function sendSpecialResponse(responseBody, roomId) {
  try {
    if (
      responseBody.hasOwnProperty("choices") &&
      responseBody.choices.length > 0
    ) {
      varAnswer = responseBody.choices[0].message.content;

      const aiReply = varAnswer; // wrappedText;
      lastResponse = aiReply;
      await sendMessage(aiReply, roomId);

      // Saving the bots response to previousMessages
      previousMessages.push(aiReply);
      if (previousMessages.length > 4) {
         previousMessages.shift();
    }

    } else {
      console.error("Invalid response from OpenAI API");
    }
  } catch (error) {
    console.error("Error in OpenAI request:", error);
    if (
      error.response &&
      (error.response.status === 429 || error.response.status === 502)
    ) {
      await sendMessage(
        "An error has occurred on the OpenAI side. You need to wait for the end of the previous request. Please try entering your question again in a minute.",
        roomId
      );
    } else {
      console.error("Unexpected error in OpenAI request:", error);
    }
  }
}

let previousMessages = [];

const runBot = async () => {
  try {
    let lastResponse = "";

    const conn = await driver.connect({
      host: ROCKETCHAT_URL,
      useSsl: false,
    });

    await driver.login({
      username: ROCKETCHAT_USER,
      password: ROCKETCHAT_PASSWORD,
    });


    await driver.joinRooms([rocketChatChannel]);
    await driver.subscribeToMessages();

    driver.reactToMessages(async (err, message, messageOptions) => {
      if (err) {
        console.error(err);
        return;
      }

      if (message.msg && !message.bot && message.rid) {
        previousMessages.push(message.msg);
        if (previousMessages.length > 4) {
          previousMessages.shift();
        }

        await delay(2000);

        const requestBody = {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            ...previousMessages.map((msg, index) => ({
              role: index % 8 === 0 ? "user" : "assistant",
              content: msg,
            })),
            { role: "user", content: message.msg },
          ],
          temperature: 0.2,
        };



	const requestBodyAskForInternet = {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            ...previousMessages.map((msg, index) => ({
              role: index % 1 === 0 ? "user" : "assistant",
              content: msg,
            })),
            { role: "user", content: message.msg },
          ],
          temperature: 0.2,
        };

        await sendMessage("typing ...", message.rid);

        if (message.msg.startsWith("... ")) {
          const searchResults = await searchQuery(message.msg.slice(6));
	  if (searchResults && searchResults.length > 0) {
            const linksToAnalyze = searchResults
              .map((result) => `${result.link}`)
              .join("\n");

            const title = searchResults.map(result => `- ${result.title}`).join('\n');
	    const tl = title.replace(/[\#\$\%\&\(\)\*\+\/:;<=>\?@\^_\{\|\}\~]/g, '');

            requestBodyAskForInternet.messages.push({
              role: "user",
              content: `Show page descriptions:${linksToAnalyze} give your comprehensive assessment of the information found on requests and the conclusion of what you analyzed. This is title:${tl} -> This is link:${linksToAnalyze}. In completing your answer, you must 100% use the following: [title](link) ( brackets and quotes must be preserved ) | a brief analysis of the page and general conclusions for all pages - page analysis and general output should be added`,
            });

            const response = await axios.post(openaiEndpoint, requestBodyAskForInternet, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
            });

            // Use sendSpecialResponse to send an unfiltered response
            sendSpecialResponse(response.data, message.rid);
          } else {
            requestBody.messages[requestBody.messages.length - 1].content = `${searchMessage}`;
            const response = await axios.post(openaiEndpoint, requestBody, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
            });

            sendResponse(response.data, message.rid);
          }
        } else {
          const response = await axios.post(openaiEndpoint, requestBody, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
          });

          sendResponse(response.data, message.rid);
        }
      }
    });

} catch (err) {
  console.log("An error has occurred: ", err);
  }
}
runBot();