const fs = require('fs');
const p = 'C:/Users/user-pc/Documents/MemeorAid1/frontend-react/src/styles/global.css';
let c = fs.readFileSync(p, 'utf8');
const before = (c.match(/\\n/g) || []).length;
c = c.split('\\n').join('\n');
c = c.split('\\r').join('\r');
fs.writeFileSync(p, c);
console.log('replaced', before, 'escaped newline sequences');
