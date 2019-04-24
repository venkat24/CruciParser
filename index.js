const whatsapp = require('whatsapp-chat-parser');
const json2csv = require('json2csv');
const fs = require('fs');
const { getEnum, isPositiveStatement, isProbablyAnAnnoClue } = require('./utils');

/**
 * This method removes extraneus messages like "Venkatraman Srikanth joined the group"
 * and also splits up multi-line messages, so that multiple clues sent as a single
 * message will be parsed independently
 * 
 * @param {Array[Message]} messages 
 */
const preprocessMessages = (messages) => {
  let processedMessages = [];

  for (const msg of messages) {
    // Remove system messages
    if (msg.message === "This message was deleted" || msg.author == "System") {
      continue;
    }

    // Split multi-line messages as independent messages
    if (msg.message.includes('\n')) {
      const splitMessages = msg.message.split("\n");
      for (const splitMessage of splitMessages) {
        processedMessages.push({
          date: msg.date,
          author: msg.author,
          message: splitMessage
        });
      }
    } else {
      processedMessages.push(msg);
    }
  }

  return processedMessages;
};

/**
 * Mark clues will mark messages that are crossword clues with message.clue = true
 * It searches for clues having an enum marker. If the message does contain a clue,
 * then the enum is also fetched.
 * 
 * @param {Array[Message]} messages
 */
const markClues = (messages) => {
  // Regular expression to find clues that contain an enum like (8) or (4,5,7)
  // Matches '(', then 0 or more instances of a set of digits followd by a comma, and then
  // matches a single set of digits, and finally ')'
  const regex = /\((\d*(,|-))*(\d*)\)/;

  // Transform each message as..
  return messages.map((msg) => {
    const match = msg.message.match(regex);

    // If there's a match and the clue is not an obvious false positive..
    if (match && isProbablyAGoodClue(msg.message)) {
      // Get enum and calculate the enum total
      const enumVals = getEnum(match[0]);
      const enumTotal = enumVals.reduce((p, acc) => p + acc);
      return {...msg, clue: true, enumVals: getEnum(match[0]), enumTotal}
    } else {
      return {...msg, clue: false}
    }
  });
};

/**
 * Given a message, check if this message contains an answer that satisfies the
 * given enum. This method blindly returns any words in the given message that
 * matches the enum, there is no other consideration.
 * 
 * @param {String} answer Message that could possibly contain the answer
 * @param {Array[Integer]} enumVals Enum to search for in the message
 */
const checkForPossibleAnswersInClue = (answer, enumVals) => {
  // Strip special characters and convert to uppercase
  answer = answer.replace(/[^a-zA-Z ]/g, "").toUpperCase();
  const words = answer.split(" ");

  // For multi word enums, we match each subsequent word by incrementing this
  let enumPtr = 0;

  let result = [];
  let currWord = "";

  for (let i = 0; i < words.length; ++i) {

    // We have a complete match! Clear and keep searching
    if (enumPtr == enumVals.length) {
      result.push(currWord.trim());
      currWord = "";
      enumPtr = 0; 
    }
    const word = words[i];
    currWord += word;

    if (word.length == enumVals[enumPtr]) {
      // We have a match with the current word of the enum. Increment and keep looking
      enumPtr++;
      currWord += " ";
    } else {
      // No match. Clear.
      currWord = "";
      enumPtr = 0;
    }
  }

  // Handle the case where the answer is at the end of the message, or is the entire message
  if (enumPtr == enumVals.length) {
    result.push(currWord.trim());
  }

  return result;
};

/**
 * We rank answers based on frequency, and also omit some common positive replies like "YES"
 * and "YEAH" that could have been potentially been identified as correct answers. The ranking
 * is simply based on which words occur more. If a word doesn't occur much, it's removed
 * 
 * @param {Array[String]} answers Set of answers
 */
const rankAndFilterPossibleAnswers = (answers) => {
  // If there are no answers, return trivially
  if (answers.length == 0) {
    return answers;
  }

  // Create a map of words with their frequencies
  let frequencies = {};
  for (const answer of answers) {
    if (isPositiveStatement(answer)) {
      continue;
    }
  
    if (answer in frequencies) {
      frequencies[answer]++;
    } else {
      frequencies[answer] = 0;
    }
  }

  // Find the one word with maximum occurences
  let max_rank = 0;
  for (const answer in frequencies) {
    const rank = frequencies[answer];
    if (rank > max_rank) {
      max_rank = rank;
    }
  };

  // Choose only the answers with maximum frequency
  let result = [];
  for (const answer in frequencies) {
    const rank = frequencies[answer];
    if (rank == max_rank) {
      result.push(answer);
    }
  }

  return result;
};

/**
 * Scan through a set of messages after the given clue and try to find an answer
 * 
 * @param {Array[Message]} messages 
 * @param {Integer} messageIndex 
 * @param {Integer} searchDepth How many messages down should we search?
 * @param {Boolean} allowEarlyExit Should we stop if we find a "YES" ?
 */
const scanMessagesForAnswer = (messages, messageIndex, searchDepth = 5, allowEarlyExit = true) => {
  let possibleAnswers = [];

  // Get the current clue
  let currMessage = messages[messageIndex];
  const currEnum = currMessage.enumVals;
  
  // Search till the limit or the end of the chat
  const searchLimit = Math.min(messageIndex + searchDepth, messages.length);
  
  for (let j = messageIndex + 1; j < searchLimit; j++) {
    // If this message itself is a clue, it's probably not the answer
    if (messages[j].clue) {
      continue;
    }

    const checkAnswer = messages[j].message;

    // If current statement is something like a "Yes!", then it's very
    // likely that one of the previous statements contained the answer
    if (allowEarlyExit && isPositiveStatement(checkAnswer) && j > messageIndex + 2) {

      // Track backwards, checking for possible answers..
      for (let k = j - 1; k > messageIndex; --k) {
        // If this message contains special chars like - or ~, it's probably an anno, not an answer
        if (isProbablyAnAnnoClue(messages[k].message)) {
          continue;
        }
        
        possibleAnswers = checkForPossibleAnswersInClue(messages[k].message, currEnum);
        if (possibleAnswers.length > 0) {
          // We've found the first plausible answer, from tracking back from before the affirmative
          // Stop and return the current set of possible answers
          break;
        }
      }

      break;
    }

    // Add to our list of possible answers and keep searching downwards
    const currPossibleAnswers = checkForPossibleAnswersInClue(checkAnswer, currEnum);
    possibleAnswers = possibleAnswers.concat(currPossibleAnswers);
  }

  // Filter the most likely answers from the list and return
  possibleAnswers = rankAndFilterPossibleAnswers(possibleAnswers).slice(0, 3);
  currMessage.possibleAnswers = possibleAnswers;

  return currMessage;
}

/**
 * This method invokes scanMessagesForAnswer. It increases the depth and searches once
 * again if no feasible answer was found
 * 
 * @param {Array[Message]} messages 
 */
const tryFindingAnswersUsingContext = (messages) => {
  for (let i = 0; i < messages.length; ++i) {
    let currMessage = messages[i];

    // For every clue...
    if (currMessage.clue) {
      let searchDepth = 7;
      currMessage = scanMessagesForAnswer(messages, i, searchDepth);

      // While we have no answer, keep searching farther and farther
      while (currMessage.possibleAnswers.length == 0 && searchDepth < 25) {
        searchDepth += 5;
        currMessage = scanMessagesForAnswer(messages, i, searchDepth);
      }
    }
  }

  return messages;
};

/**
 * A last ditch search for answers, by invoking scanMessagesForAnswer incrementally
 * without an early exit, meaning this is a brute force search for anything that
 * matches the enum. Not ideal, but can help find some answers in cases where
 * clues are closed very late.
 * 
 * @param {Array[Message]} messages 
 */
const tryFindingAnswersUsingContextAttempt2 = (messages) => {
  for (let i = 0; i < messages.length; ++i) {
    let currMessage = messages[i];
    if (currMessage.clue && currMessage.possibleAnswers.length == 0) {
      let searchDepth = 10;
      currMessage = scanMessagesForAnswer(messages, i, searchDepth, false);
      while (currMessage.possibleAnswers.length == 0 && searchDepth < 35) {
        searchDepth += 5;
        currMessage = scanMessagesForAnswer(messages, i, searchDepth, false);
      }
    }
  }

  return messages;
};

/**
 * Removes clues that are too short
 * 
 * TODO: Improve this method to weed out other false positive clues
 * 
 * @param {String} clue 
 */
const isProbablyAGoodClue = (clue) => {
  if (clue.length > 6) return true;

  return false;
};

/// Main
const main = async () => {

  // Parse the chats file
  let messages = await whatsapp.parseFile("chats.txt");

  // Process messages by removing system messges and splitting multiline messages
  messages = preprocessMessages(messages);

  // Flag the clues as message.clue = true
  messages = markClues(messages);

  // Try finding answers by using the subsequent messages
  messages = tryFindingAnswersUsingContext(messages);

  // A more bute force search in case we couldn't find any answer in the previous step
  messages = tryFindingAnswersUsingContextAttempt2(messages);

  // Filter out just the clues now
  let clueMessages = messages.filter(message => message.clue);
  console.log(clueMessages);
  console.log("Found ", clueMessages.length, " clues!");

  // Clean it up to write to CSV
  clueMessages = clueMessages.map(({date, author, message, enumVals, enumTotal, possibleAnswers}) => {
    return {
      date,
      author,
      clue: message,
      enum: "( " + JSON.stringify(enumVals.join(", ")).slice(1,-1) + " )",
      enumTotal,
      possibleAnswer1: possibleAnswers.length > 0 ? possibleAnswers[0] : "",
      possibleAnswer2: possibleAnswers.length > 1 ? possibleAnswers[1] : "",
      possibleAnswer3: possibleAnswers.length > 2 ? possibleAnswers[2] : ""
    };
  });

  // Dump data as CSV
  let parser = new json2csv.Parser({fields: Object.keys(clueMessages[0])});
  const csvdata = parser.parse(clueMessages);

  fs.writeFileSync("out.csv", csvdata, (err) => {
    console.err("CSV Write issue!");
  });
  console.log("Clues written to out.csv");

  // ENDE!
};

main();
