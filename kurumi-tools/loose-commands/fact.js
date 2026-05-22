#!/usr/bin/env node
const facts = [
  "Bananas are berries, but strawberries aren't. Also, bananas are sterile and can only be propagated from shoots.",
  "The shortest war in history was between Britain and Zanzibar in 1896 — it lasted 38 to 45 minutes.",
  "Honey never spoils. Archaeologists have found jars of honey in ancient Egyptian tombs that are over 3000 years old and still edible.",
  "A group of flamingos is called a 'flamboyance,' which is the most accurate name ever given to anything.",
  "Octopuses have three hearts — two pump blood to the gills, one pumps it to the rest of the body.",
  "The fingerprints of koalas are so similar to human fingerprints that they could confuse crime scene investigators.",
  "Sharks have been around longer than dinosaurs. They've existed for over 400 million years.",
  "A cockroach can live for a week without its head before dying from starvation, not suffocation.",
  "The smell of petrichor (rain on dry earth) comes from bacteria called actinomycetes releasing spores.",
  "Wombats produce cubic feces. Scientists still aren't entirely sure why, but it likely prevents the poop from rolling away.",
  "The placebo effect works even if you know it's a placebo — your brain doesn't care about the truth.",
  "Dolphins have names for each other — they call out individual signature whistles.",
  "Scotland's national animal is the unicorn, which is significantly less realistic than any other country's choice.",
  "A shrimp's heart is in its head.",
  "Cows have best friends and get stressed when separated from them.",
  "The oldest known recipe is for beer, not bread, despite beer being made after bread existed.",
  "Norway has knighted a penguin named Sir Nils Olav.",
  "A group of porcupines is called a 'prickle.'",
  "The Great Wall of China is not visible from space with the naked eye — this is a persistent myth.",
  "Sloths only defecate once a week and can lose up to 30% of their body weight when they do.",
  "Butterflies taste with their feet to determine whether the plant they sit on is edible.",
  "The fingerprints of gorillas are so similar to human fingerprints they're actually distinguishable only in court.",
  "Puffins can fly underwater — their wings essentially work the same way in water as in air.",
  "The mantis shrimp can see circular polarized light and probably sees colors we can't even imagine.",
  "Turkey vultures have a sense of smell so acute they can smell carrion from over a mile away.",
  "A cat's purr vibrates at the same frequency that promotes bone healing — 25 to 150 Hertz.",
  "Otters hold hands while sleeping so they don't drift apart.",
  "The song 'Happy Birthday' is technically copyrighted, though the copyright is expiring.",
  "Scotland tried to ban Muslim headscarves in 2014 but accidentally banned face paint, masks, and costumes in the process.",
  "Penguin knees exist — they're just hidden inside their bodies, making them appear to be all legs and torso.",
];
function getRandomFact() {
  return facts[Math.floor(Math.random() * facts.length)];
}
console.log(getRandomFact());
