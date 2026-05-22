#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dataFile = path.join(__dirname, 'birthdays.json');
function loadBirthdays() {
  try {
    if (fs.existsSync(dataFile)) {
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    }
  } catch (e) {}
  return {};
}
function saveBirthdays(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}
function addBirthday(userId, date) {
  const birthdays = loadBirthdays();
  birthdays[userId] = date;
  saveBirthdays(birthdays);
  return true;
}
function removeBirthday(userId) {
  const birthdays = loadBirthdays();
  delete birthdays[userId];
  saveBirthdays(birthdays);
  return true;
}
function checkTodaysBirthdays() {
  const birthdays = loadBirthdays();
  const today = new Date().toISOString().split('T')[0].slice(5);
  const celebrating = [];
  for (const [userId, date] of Object.entries(birthdays)) {
    if (date.slice(5) === today) {
      celebrating.push(userId);
    }
  }
  return celebrating;
}
function listBirthdays() {
  const birthdays = loadBirthdays();
  return Object.entries(birthdays).map(([userId, date]) => ({
    userId,
    date,
    daysUntil: daysUntilBirthday(date)
  })).sort((a, b) => a.daysUntil - b.daysUntil);
}
function daysUntilBirthday(dateStr) {
  const [month, day] = dateStr.slice(5).split('-').map(Number);
  const today = new Date();
  const nextBirthday = new Date(today.getFullYear(), month - 1, day);
  if (nextBirthday < today) {
    nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((nextBirthday - today) / msPerDay);
}
const argsJson = process.argv[2];
let cmd = '', userId = '', date = '';
if (argsJson) {
  try {
    const args = JSON.parse(argsJson);
    cmd = args.action || args.cmd || '';
    userId = args.userid || '';
    date = args.date || '';
  } catch {
    cmd = argsJson;
    userId = process.argv[3] || '';
    date = process.argv[4] || '';
  }
}
if (cmd === 'add' && userId && date) {
  addBirthday(userId, date);
  console.log(`Added birthday for ${userId}: ${date}`);
} else if (cmd === 'remove' && userId) {
  removeBirthday(userId);
  console.log(`Removed birthday for ${userId}`);
} else if (cmd === 'today') {
  const today = checkTodaysBirthdays();
  if (today.length > 0) {
    console.log('Birthdays today:', today.join(', '));
  } else {
    console.log('No birthdays today.');
  }
} else if (cmd === 'list') {
  const list = listBirthdays();
  if (list.length > 0) {
    list.forEach(({ userId, date, daysUntil }) => {
      console.log(`${userId}: ${date} (${daysUntil} days)`);
    });
  } else {
    console.log('No birthdays tracked.');
  }
} else {
  console.log('Usage: birthday-reminder.js [add|remove|today|list] [userid] [YYYY-MM-DD]');
}
