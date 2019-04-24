# CruciParser

Script to parse all Cryptic Crossword clues from the WhatsApp dump of a group. Parses clues and attempts to find answers using the context of the 
conversation.

### Purpose

Here's an excerpt from a WhatsApp group where people post clues to Cryptic Crossword puzzles, and other users solve them.

```
18/04/2019, 10:37 - Shivesh: Clue from litweek; please don't answer if you attended

Pampered and cuddled with third wife (5,3)
18/04/2019, 10:37 - Gautham Mahadevan: spoon fed
18/04/2019, 10:37 - Gautham Mahadevan: spooned<--f
18/04/2019, 10:37 - Shivesh: Yep. Nice solve.
18/04/2019, 10:37 - Gautham Mahadevan: Nice clue
18/04/2019, 10:48 - AniJ: How apt
18/04/2019, 10:50 - Gautham Mahadevan: 😶
18/04/2019, 13:07 - Venkatraman Srikanth: An organ in favour of situation (8)
18/04/2019, 13:15 - Santhosh Feeds: Prostate
18/04/2019, 13:41 - Venkatraman Srikanth: Yes
19/04/2019, 23:31 - Gautham Mahadevan: Rocks are not fancy (6)
19/04/2019, 23:35 - Gautham Mahadevan: You deleted this message
19/04/2019, 23:36 - Gautham Mahadevan: No leaves/interval/breaks? Get caught, straight up! (8)
19/04/2019, 23:37 - +1 (404) 452-4018: Ornate.
Are not*
19/04/2019, 23:38 - +91 99620 02449: Sentence
19/04/2019, 23:38 - Gautham Mahadevan: Yes!
19/04/2019, 23:38 - Gautham Mahadevan: Could you anno? Not the answer I had in mind
19/04/2019, 23:39 - +91 99620 02449: Get caught, you get a sentence
A sentence stops at a break, a full stop
19/04/2019, 23:41 - Gautham Mahadevan: Ah that's not what I had in mind
19/04/2019, 23:41 - Gautham Mahadevan: Creative answer though
20/04/2019, 00:25 - Swathi USA: Vertical
20/04/2019, 00:26 - Swathi USA: (Iterval+c)*
20/04/2019, 07:43 - Gautham Mahadevan: Yes
```

This project aims to filter out just the clues and organize them, and also guess the answer from the context, where other people would have answered them.

From the given chat data, this program generates JSON  that looks like -

```javascript
[ { date: 2019-04-18T05:07:00.000Z,
    author: 'Shivesh',
    message: 'Pampered and cuddled with third wife (5,3)',
    clue: true,
    enumVals: [ 5, 3 ],
    enumTotal: 8,
    possibleAnswers: [ 'SPOON FED' ] },
  { date: 2019-04-18T07:37:00.000Z,
    author: 'Venkatraman Srikanth',
    message: 'An organ in favour of situation (8)',
    clue: true,
    enumVals: [ 8 ],
    enumTotal: 8,
    possibleAnswers: [ 'PROSTATE' ] },
  { date: 2019-04-19T18:01:00.000Z,
    author: 'Gautham Mahadevan',
    message: 'Rocks are not fancy (6)',
    clue: true,
    enumVals: [ 6 ],
    enumTotal: 6,
    possibleAnswers: [ 'ORNATE' ] },
  { date: 2019-04-19T18:06:00.000Z,
    author: 'Gautham Mahadevan',
    message: 'No leaves/interval/breaks? Get caught, straight up! (8)',
    clue: true,
    enumVals: [ 8 ],
    enumTotal: 8,
    possibleAnswers: [ 'SENTENCE' ] } ]
```

and tabulates this into a CSV file as well.

### Working

The clues are filtered by matching against a regex to check for all messages that contain a crossword enum, or letter count. Enums look like (5) or (2,3,5).

Once the clues are marked, for each clue, a suitable set of answers are found by searching for words of an appropriate enum in messages below the clue. Encountering an affirmative word like "YES" or "NICE" will cause the checker to track backwards and choose the first found answer as the right one.

### Usage

1. `npm install`

2. `cp chats.txt.example` `chats.txt` (or paste your own Cruciverbalists export)

3. `node index.js`
