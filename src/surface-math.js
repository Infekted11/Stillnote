const functions = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  log: Math.log10, ln: Math.log, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow,
};

export function compileSurfaceExpression(source) {
  const input = String(source || '').replace(/\s+/g, '');
  if (!input || input.length > 240) throw new Error('Enter a function using x and y (up to 240 characters).');
  let cursor = 0;
  const peek = () => input[cursor];
  const eat = (value) => { if (input.slice(cursor, cursor + value.length).toLowerCase() === value) { cursor += value.length; return true; } return false; };
  const expression = () => { let left = term(); while (true) { if (eat('+')) { const a=left,b=term(); left=(x,y)=>a(x,y)+b(x,y); } else if (eat('-')) { const a=left,b=term(); left=(x,y)=>a(x,y)-b(x,y); } else return left; } };
  const term = () => { let left=unary(); while(true) { if(eat('*')){const a=left,b=unary();left=(x,y)=>a(x,y)*b(x,y);}else if(eat('/')){const a=left,b=unary();left=(x,y)=>a(x,y)/b(x,y);}else if(eat('%')){const a=left,b=unary();left=(x,y)=>a(x,y)%b(x,y);}else return left;} };
  const unary = () => { if(eat('+'))return unary();if(eat('-')){const a=unary();return(x,y)=>-a(x,y);}return power(); };
  const power = () => { let left=atom();if(eat('^')){const a=left,b=unary();left=(x,y)=>a(x,y)**b(x,y);}return left; };
  const atom = () => {
    if(eat('(')){const value=expression();if(!eat(')'))throw new Error('Missing closing parenthesis.');return value;}
    const number=input.slice(cursor).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if(number){cursor+=number[0].length;const value=Number(number[0]);return()=>value;}
    const name=input.slice(cursor).match(/^[a-zA-Z]+/);
    if(name){cursor+=name[0].length;const id=name[0].toLowerCase();if(id==='x')return x=>x;if(id==='y')return(_x,y)=>y;if(id==='pi')return()=>Math.PI;if(id==='e')return()=>Math.E;
      const fn=functions[id];if(!fn)throw new Error(`Unknown name “${id}”. Use x, y, pi, e, and standard math functions.`);
      if(!eat('('))throw new Error(`Function ${id} needs parentheses.`);const args=[expression()];while(eat(','))args.push(expression());if(!eat(')'))throw new Error('Missing closing parenthesis.');if(['min','max','pow'].includes(id)?args.length<2:args.length!==1)throw new Error(`${id} needs ${['min','max','pow'].includes(id)?'at least two':'one'} argument${['min','max','pow'].includes(id)?'s':''}.`);return(x,y)=>fn(...args.map(arg=>arg(x,y)));}
    throw new Error(`Unexpected character “${peek()||'end of expression'}”.`);
  };
  const result=expression();if(cursor!==input.length)throw new Error(`Unexpected character “${peek()}”.`);return result;
}
