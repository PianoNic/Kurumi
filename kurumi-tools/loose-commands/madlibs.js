#!/usr/bin/env node
const templates = [
  { story: "I went to the store and bought a {adjective} {noun}. The cashier said it would cost {number} dollars. I told them that was {adjective} and left with {number} {plural_noun}.", blanks: ["adjective", "noun", "number", "adjective", "number", "plural_noun"] },
  { story: "My friend {name} is a {occupation} who {verb}s for a living. They make {number} {plural_noun} per day and wear a {adjective} {noun}.", blanks: ["name", "occupation", "verb", "number", "plural_noun", "adjective", "noun"] },
  { story: "The {adjective} {noun} walked into a {adjective} bar. The bartender said '{exclamation}!' and served them a {liquid} with a {noun} on top.", blanks: ["adjective", "noun", "adjective", "exclamation", "liquid", "noun"] },
  { story: "Last night I dreamed I was a {noun} made of {material}. I could {verb} really fast and my favorite food was {food}.", blanks: ["noun", "material", "verb", "food"] },
];
const wordTypes = {
  adjective: "an adjective (e.g., silly, purple, furious)",
  noun: "a noun (e.g., elephant, pizza, lamp)",
  plural_noun: "a plural noun (e.g., cats, pizzas, lamps)",
  verb: "a verb (e.g., run, jump, whisper)",
  number: "a number",
  name: "a name",
  occupation: "an occupation (e.g., astronaut, chef)",
  exclamation: "an exclamation (e.g., Wow!, Help!, Yikes!)",
  liquid: "a liquid (e.g., milk, lava, perfume)",
  material: "a material (e.g., rubber, gold, cheese)",
  food: "a food"
};
function getRandomTemplate() {
  return templates[Math.floor(Math.random() * templates.length)];
}
function formatPrompt(wordType) {
  return wordTypes[wordType] || wordType;
}
const template = getRandomTemplate();
console.log("Mad Libs Game");
console.log("=============");
console.log("\nFill in the following blanks:");
template.blanks.forEach((blank, i) => {
  console.log(`${i + 1}. ${formatPrompt(blank)}`);
});
console.log("\nStory template will use your words to create something hilarious.");
