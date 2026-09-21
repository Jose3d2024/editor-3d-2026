fetch('https://stackoverflow.com/a/66978236/1314762').then(r=>r.text()).then(t=>console.log(t.substring(t.indexOf('answer-66978236'), t.indexOf('answer-66978236')+2000)))
