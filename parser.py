from bs4 import BeautifulSoup as bs
import re
import csv

# These are the specific classes which contain each message, and the div inside
# that contains the author information. This is probably likely to change, so update
# this based on the stuff in the HTML
MESSAGE_CONTAINER_CLASS="vW7d1"
AUTHOR_CONTAINER_CLASS="_3Usvm"

# Open the HTML file, and let BeautifulSoup parse the whole thing
f = open("text.html")
s = f.read()
soup = bs(s, "html.parser")

# From the parsed output, get all of the message containers into a list
message_containers = soup.findAll('div', {"class": MESSAGE_CONTAINER_CLASS})

# Our final output is going to go into this global here
clues = []

for message_html in message_containers:
    # Extract message text
    # The text is in a span with classname "selectable-text"
    # If it doesn't exist (because of stuff like weird image divs), skip
    possibly_message_text = message_html.find('span', {"class": "selectable-text"})
    if not possibly_message_text:
        continue

    # This regex matches every clue that has an enum like (5) or (4,5)
    # If it fails, this message is probably not a clue, so skip
    message_text = possibly_message_text.text
    clue_regex = r"^.*\((\d*,)*(\d*)\).*$"
    if not re.match(clue_regex, message_text):
        continue

    # At this point, this is a valid clue, so try extracting the author
    author_info_container = message_html.find('div', {"class": AUTHOR_CONTAINER_CLASS})
    if (author_info_container):
        # The author info data is in the data-pre-plain-text attribute
        author_info = author_info_container["data-pre-plain-text"]

        # The info text looks like "[4:12 PM, 3/31/2019] Kuchu Gautham: "
        # The regex match just splits this up and extracts each part
        author_regex = r'^\[(.*)\,(.*)\]\ (.*):'
        author_match = re.match(author_regex, author_info)

        if author_match:
            clue = {
                "time": author_match.group(1),
                "date": author_match.group(2),
                "author": author_match.group(3),
                "text": message_text 
            }
            clues.append(clue)

for clue in clues:
    print(clue)

# Open up a CSV file and write all the data in clues to file
with open("out.csv", "w") as csvfile:
    headers = clues[0].keys()
    writer = csv.DictWriter(csvfile, headers)
    writer.writeheader()
    writer.writerows(clues)
