const whatsapp = require('whatsapp-chat-parser');
const json2csv = require('json2csv');
const fs = require('fs');

const positiveReplies = [
  "👍",
  "👍🏻",
  "👍🏼",
  "👍🏽",
  "👍🏾",
  "👍🏿",
  "YES",
  "YESS",
  "YESSS",
  "YEAH",
  "YEAHH",
  "YUP",
  "YUPP",
  "YUPPP",
  "YEH",
  "YAH",
  "YAS",
  "YEP",
  "YEPP",
  "NICE",
  "ADHE",
  "ADHEY",
  "CORRECT",
];

const negativeReplies = [
  "NOPE",
  "NO",
  "NOT WHAT I",
  "NOT REALLY"
];

const preprocessMessages = (messages) => {
  let processedMessages = [];
  for (const msg of messages) {
    if (msg.message === "This message was deleted") {
      continue;
    }
    if (msg.author == "System") {
      continue;
    }
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

const getEnum = (enumString) => {
  enumString = enumString.substring(1, enumString.length - 1);
  enumArray = enumString.replace(/-/g, ',').split(',').map(e => parseInt(e));
  return enumArray;
};

const markClues = (messages) => {
  const regex = /\((\d*(,|-))*(\d*)\)/;
  return messages.map((msg) => {
    const match = msg.message.match(regex);
    if (match && isProbablyAGoodClue(msg.message)) {
      const enumVals = getEnum(match[0]);
      const enumTotal = enumVals.reduce((p, acc) => p + acc);
      return {...msg, clue: true, enumVals: getEnum(match[0]), enumTotal}
    } else {
      return {...msg, clue: false}
    }
  });
};

const isPositiveStatement = (answer) => {
  answer = answer.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '').toUpperCase();
  const words = answer.split(" ");
  for (const word of words) {
    if (positiveReplies.indexOf(word) >= 0) {
      return true;
    }
  }

  return false;
};

const isProbablyAnAnnoClue = (clue) => {
  const annoChars = ["-", ">", "<", "~", "*", "+", "←"];
  for (const char of annoChars) {
    if (clue.indexOf(char) >= 0) {
      return true;
    }
  }

  return false;
}

const checkForPossibleAnswersInClue = (answer, enumVals) => {
  answer = answer.replace(/[^a-zA-Z ]/g, "").toUpperCase();
  const words = answer.split(" ");
  let enumPtr = 0;

  let result = [];
  let currWord = "";
  for (let i = 0; i < words.length; ++i) {
    if (enumPtr == enumVals.length) {
      result.push(currWord.trim());
      currWord = "";
      enumPtr = 0; 
    }
    const word = words[i];
    currWord += word;
    if (word.length == enumVals[enumPtr]) {
      enumPtr++;
      currWord += " ";
    } else {
      currWord = "";
      enumPtr = 0;
    }
  }
  if (enumPtr == enumVals.length) {
    result.push(currWord.trim());
  }
  return result;
};

const rankAndFilterPossibleAnswers = (answers) => {
  if (answers.length == 0) {
    return answers;
  }

  let ranks = {};
  for (const answer of answers) {
    if (isPositiveStatement(answer)) {
      continue;
    }
  
    if (answer in ranks) {
      ranks[answer]++;
    } else {
      ranks[answer] = 0;
    }
  }

  let max_rank = 0;
  for (const answer in ranks) {
    const rank = ranks[answer];
    if (rank > max_rank) {
      max_rank = rank;
    }
  };

  let result = [];
  for (const answer in ranks) {
    const rank = ranks[answer];
    if (rank == max_rank) {
      result.push(answer);
    }
  }

  return result;
};

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
};

main();
