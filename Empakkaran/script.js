let burps = JSON.parse(localStorage.getItem('burps')) || [];

function logBurp() {
  const now = new Date();
  burps.push(now.toISOString());
  localStorage.setItem('burps', JSON.stringify(burps));
  updateDisplay();
  randomMessage();
}

function updateDisplay() {
  const list = document.getElementById('burpList');
  const count = document.getElementById('burpCount');
  list.innerHTML = '';

  let todayCount = 0;
  const today = new Date().toDateString();

  burps.slice().reverse().forEach(burp => {
    const date = new Date(burp);
    if (date.toDateString() === today) todayCount++;

    const li = document.createElement('li');
    li.textContent = `${date.toLocaleTimeString()} - ${date.toDateString()}`;
    list.appendChild(li);
  });

  count.textContent = todayCount;
}

function randomMessage() {
  const messages = [
    "💨 That one shook the floor!",
    "🍕 Maybe eat slower next time.",
    "🫢 You’re on a roll!",
    "🥤 Was that soda again?",
    "🤔 Consider checking with a doctor if this continues!"
  ];
  alert(messages[Math.floor(Math.random() * messages.length)]);
}

// Show burps on page load
updateDisplay();
