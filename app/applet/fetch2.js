import { JSDOM } from 'jsdom';
fetch('https://stackoverflow.com/a/66978236/1314762').then(r=>r.text()).then(t=>{
  const dom = new JSDOM(t);
  const answer = dom.window.document.getElementById('answer-66978236');
  console.log(answer.querySelector('.s-prose').textContent);
});
