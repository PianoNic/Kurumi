#!/usr/bin/env node
// Niche poll generator — absurdly specific, pointless, hilarious questions

const polls = [
  {
    question: "If you could only eat food in one temperature forever, which would it be?",
    options: ["Piping hot", "Room temperature", "Ice cold", "Lukewarm and disappointing"],
    category: "food"
  },
  {
    question: "How do you feel about people who alphabetize their spice rack?",
    options: ["They're living in 3025", "Unnecessary chaos", "I respect the commitment", "Who has time for this?"],
    category: "organization"
  },
  {
    question: "If you had to describe your personality as a kitchen appliance, what would it be?",
    options: ["Microwave (fast, efficient)", "Oven (steady, reliable)", "Blender (chaotic energy)", "Coffee maker (needs to wake up)"],
    category: "personality"
  },
  {
    question: "Would you trust someone who eats pizza with a fork and knife?",
    options: ["Yes, they're cultured", "No, they're a monster", "Depends on the pizza", "I don't trust them for other reasons"],
    category: "food"
  },
  {
    question: "What's your stance on people who use 'whom' correctly in casual conversation?",
    options: ["Intimidating", "Respect the effort", "Who cares", "It's actually annoying"],
    category: "language"
  },
  {
    question: "If your life was a Netflix series, what genre would it be?",
    options: ["Comedy", "Drama", "Thriller", "Documentary nobody asked for"],
    category: "self"
  },
  {
    question: "How many USB ports is too many on a laptop?",
    options: ["Can never have too many", "4-6 is fine", "2-3 is enough", "They should all be wireless"],
    category: "tech"
  },
  {
    question: "Do you read the terms and conditions?",
    options: ["Always", "Sometimes", "Never", "I skim them and pray"],
    category: "honesty"
  },
  {
    question: "What's your opinion on people who unplug their router to turn it off?",
    options: ["Absolute barbarians", "It works, doesn't it?", "There's a power button for a reason", "I do it too"],
    category: "tech"
  },
  {
    question: "How do you order hot beverages at a coffee shop?",
    options: ["Black, no nonsense", "Specific and complex", "Whatever the barista suggests", "Iced, always"],
    category: "food"
  },
  {
    question: "If you could rename one day of the week, what would you call it?",
    options: ["Something motivational", "Something funny", "I wouldn't change anything", "I'd delete one instead"],
    category: "silly"
  },
  {
    question: "Do you rearrange your furniture to feel productive?",
    options: ["Constantly", "Once a year", "Never, it's perfect", "Only when stressed"],
    category: "organization"
  },
  {
    question: "How many browser tabs is healthy to have open?",
    options: ["1-3, like a normal person", "10-20, manageable chaos", "50+, don't ask", "Safari doesn't tell me anyway"],
    category: "tech"
  },
  {
    question: "What's your take on people who put pineapple on pizza?",
    options: ["It's amazing", "It's fine", "It's controversial but I respect it", "They're wrong and I can't be friends"],
    category: "food"
  },
  {
    question: "If you had to pick a conspiracy theory you almost believe, which would it be?",
    options: ["Big Pharma", "Big Tech", "Big Cheese", "Aliens already visited us"],
    category: "silly"
  },
  {
    question: "How many 'good mornings' does it take to actually feel awake?",
    options: ["One's enough", "Three minimum", "I don't count", "Sleep is the answer"],
    category: "self"
  },
  {
    question: "Do you read the instructions before assembling furniture?",
    options: ["Always", "Sometimes", "Never", "Only after I mess it up"],
    category: "honesty"
  },
  {
    question: "What's your relationship with notifications?",
    options: ["All on, I like chaos", "Selective, I have standards", "Mostly off, it's peaceful", "I disabled all of them"],
    category: "tech"
  }
];

function getRandomPoll() {
  return polls[Math.floor(Math.random() * polls.length)];
}

function getPollsByCategory(category) {
  return polls.filter(poll => poll.category === category);
}

function getAllCategories() {
  return [...new Set(polls.map(poll => poll.category))];
}

module.exports = {
  getRandomPoll,
  getPollsByCategory,
  getAllCategories,
  polls
};

if (require.main === module) {
  const poll = getRandomPoll();
  console.log(poll.question);
  poll.options.forEach((option, i) => {
    console.log(`${i + 1}. ${option}`);
  });
  console.log(`\nCategory: ${poll.category}`);
}
