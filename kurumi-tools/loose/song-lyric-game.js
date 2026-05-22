#!/usr/bin/env node
const songs = [
  { artist: "Queen", title: "Bohemian Rhapsody", lyric: "is this the real life, is this just fantasy?", blanks: "___ __ ___ ____, ___ ____ ____ ________?" },
  { artist: "The Beatles", title: "Hey Jude", lyric: "hey jude, don't make it bad, take a sad song and make it better", blanks: "___ ____, ____ ____ __, ____ _ ___ ____ ___ ____ __" },
  { artist: "David Bowie", title: "Space Oddity", lyric: "ground control to major tom", blanks: "______ _______ __ _____ ___" },
  { artist: "Imagine Dragons", title: "Radioactive", lyric: "i'm waking up to ash and dust", blanks: "__ ______ __ __ ___ ____" },
  { artist: "The Rolling Stones", title: "Paint It Black", lyric: "i see a red door and i want it painted black", blanks: "_ ___ _ ___ ____ ___ _ ____ __ _______ _____" },
  { artist: "Led Zeppelin", title: "Stairway to Heaven", lyric: "there's a lady who's sure all that glitters is gold", blanks: "______ _ _____ ___ ____ ___ ____ _______ __ ____" },
  { artist: "Nirvana", title: "Smells Like Teen Spirit", lyric: "come as you are, as you were", blanks: "____ __ ___ ___, __ ___ ____" },
  { artist: "Pink Floyd", title: "Comfortably Numb", lyric: "hello, is there anybody in there?", blanks: "______, __ _____ _______ __ _____?" },
  { artist: "The Who", title: "My Generation", lyric: "people try to put us d-down, talking 'bout my generation", blanks: "______ ___ __ ___ __ ____, _______ _____ __ __________" },
  { artist: "Blondie", title: "Heart of Glass", lyric: "once i had a love and it was a gas, soon turned out i had a blast", blanks: "____ _ ___ _ ____ ___ __ ___ ___, ____ ______ ___ _ ___ _____" },
  { artist: "The Clash", title: "Should I Stay or Should I Go", lyric: "should i stay or should i go now?", blanks: "______ _ ____ __ ______ _ __?" },
  { artist: "Joy Division", title: "Love Will Tear Us Apart", lyric: "love will tear us apart again", blanks: "____ ____ ____ __ ______ _____" },
  { artist: "Metallica", title: "Enter Sandman", lyric: "say your prayers, little one, don't forget my son", blanks: "__ ____ ______, _____ ___, ____ _______ __ ___" },
  { artist: "Guns N' Roses", title: "Sweet Child O' Mine", lyric: "she's got a smile that it seems to me reminds me of childhood memories", blanks: "___'_ ___ _ _____ ____ __ ____ _______ __ _________ _________" },
  { artist: "AC/DC", title: "Back in Black", lyric: "back in black, i hit the sack", blanks: "____ __ _____, _ ___ ___ ____" },
];
function getRandomSong() {
  return songs[Math.floor(Math.random() * songs.length)];
}
const prompt = getRandomSong();
console.log("Guess the song from the blanked lyric:\n");
console.log(prompt.blanks);
console.log("\nFull lyric:", prompt.lyric);
console.log("Artist:", prompt.artist);
console.log("Title:", prompt.title);
