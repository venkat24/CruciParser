const constants = require('./constants');

const getEnum = (enumString) => {
  enumString = enumString.substring(1, enumString.length - 1);
  enumArray = enumString.replace(/-/g, ',').split(',').map(e => parseInt(e));
  return enumArray;
};

const isPositiveStatement = (answer) => {
  answer = answer.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '').toUpperCase();
  const words = answer.split(' ');
  for (const word of words) {
    if (constants.positiveReplies.indexOf(word) >= 0) {
      return true;
    }
  }

  return false;
};

const isProbablyAnAnnoClue = (clue) => {
  const annoChars = ['-', '>', '<', '~', '*', '+', '←'];
  for (const char of annoChars) {
    if (clue.indexOf(char) >= 0) {
      return true;
    }
  }

  return false;
}

module.exports = {getEnum, isPositiveStatement, isProbablyAnAnnoClue};
