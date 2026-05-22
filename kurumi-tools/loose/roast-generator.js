#!/usr/bin/env node
// Roast generator — playful, edgy comebacks and burns

const templates = [
  "I'd roast you, but my mom told me not to play with trash.",
  "You're not dumb, you're just operating on different software.",
  "If you were a vegetable, you'd be a turnip — nobody wants you around.",
  "Your life is like a browser with 47 tabs open. Nobody knows what's happening.",
  "I'd tell you to go outside, but the sun's not interested in seeing you either.",
  "You're the human equivalent of a 404 error — not found, not relevant, not useful.",
  "I'd say you have a bright future, but your past is pretty dim.",
  "You're proof that evolution can go backwards.",
  "If stupidity is a crime, you're the Alcatraz of bad decisions.",
  "You're like a cloud. When you disappear, it's a nice day.",
  "Calling you stupid would be an insult to stupid people.",
  "Your brain must feel so empty with nothing to do all day.",
  "You're the reason they invented mute buttons.",
  "If you were a programming language, you'd be broken code.",
  "You'd be a great teacher — a great example of what not to do.",
  "Your IQ is lower than the WiFi signal in your basement.",
  "You're living proof that the internet should have age restrictions.",
  "I'd roast you harder, but I'm running out of creative insults.",
  "You're like a bad WiFi connection — unreliable and always dropping.",
  "If ignorance is bliss, you must be the happiest person alive.",
  "You're the human equivalent of a Windows update. Unwanted and takes forever.",
  "Your jokes are like your personality — forced and uncomfortable.",
  "I'm not saying you're stupid, I'm saying you make smart people question their intelligence.",
  "You're a human participation trophy.",
  "If you were a typo, you'd be permanent.",
  "You're what happens when evolution takes a nap.",
  "Your life is a Netflix series that got cancelled after one episode.",
  "You're a living reminder that natural selection isn't working.",
  "If your face was a LinkedIn profile, it'd say 'under maintenance.'",
];

function getRandomRoast() {
  return templates[Math.floor(Math.random() * templates.length)];
}

function generateRoastFor(name) {
  const roast = getRandomRoast();
  return roast.replace(/you/gi, (match) => {
    return match === 'you' ? name || 'you' : name.toUpperCase() || 'YOU';
  });
}

module.exports = {
  getRandomRoast,
  generateRoastFor,
  templates
};

if (require.main === module) {
  const name = process.argv[2];

  if (name) {
    console.log(generateRoastFor(name));
  } else {
    console.log(getRandomRoast());
  }
}
