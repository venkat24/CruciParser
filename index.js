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
 * @param {Integer} message_index 
 * @param {Integer} searchDepth 
 * @param {Boolean} allowEarlyExit 
 */
const scanMessagesForAnswer = (messages, message_index, searchDepth = 5, allowEarlyExit = true) => {
  let possibleAnswers = [];
  let currMessage = messages[message_index];
  const currEnum = currMessage.enumVals;
  const searchLimit = Math.min(message_index + searchDepth, messages.length);
  for (let j = message_index + 1; j < searchLimit; j++) {
    if (messages[j].clue) {
      continue;
    }

    const checkAnswer = messages[j].message;

    // If current statement is something like a "Yes!", then it's very
    // likely that the previous statement contained the answer
    if (allowEarlyExit && isPositiveStatement(checkAnswer) && j > message_index + 2) {

      // Track backwards, checking for possible answers..
      for (let k = j - 1; k > message_index; --k) {
        if (isProbablyAnAnnoClue(messages[k].message)) {
          continue;
        }
        possibleAnswers = checkForPossibleAnswersInClue(messages[k].message, currEnum);
        if (possibleAnswers.length > 0) {
          // We've found the first plausible answer, from tracking back from before the affirmative
          break;
        }
      }

      break;
    }

    const currPossibleAnswers = checkForPossibleAnswersInClue(checkAnswer, currEnum);

    possibleAnswers = possibleAnswers.concat(currPossibleAnswers);
  }

  possibleAnswers = rankAndFilterPossibleAnswers(possibleAnswers).slice(0, 3);
  currMessage.possibleAnswers = possibleAnswers;

  return currMessage;
}

const tryFindingAnswersUsingContext = (messages) => {
  for (let i = 0; i < messages.length; ++i) {
    let currMessage = messages[i];
    if (currMessage.clue) {
      let searchDepth = 7;
      currMessage = scanMessagesForAnswer(messages, i, searchDepth);
      while (currMessage.possibleAnswers.length == 0 && searchDepth < 20) {
        searchDepth += 5;
        currMessage = scanMessagesForAnswer(messages, i, searchDepth);
      }
    }
  }

  return messages;
};

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

const isProbablyAGoodClue = (clue) => {
  if (clue.length > 6) return true;

  return false;
};

const main = async () => {
  let messages = await whatsapp.parseFile("chats.txt");
  messages = preprocessMessages(messages);
  messages = markClues(messages);
  messages = tryFindingAnswersUsingContext(messages);
  messages = tryFindingAnswersUsingContextAttempt2(messages);

  let clueMessages = messages.filter(message => message.clue);
  console.log(clueMessages);
  console.log("Found ", clueMessages.length, " clues!");
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

  let parser = new json2csv.Parser({fields: Object.keys(clueMessages[0])});
  const csvdata = parser.parse(clueMessages);

  fs.writeFileSync("out.csv", csvdata, (err) => {
    console.err("CSV Write issue!");
  });
  console.log("Clues written to out.csv");
};

main();
