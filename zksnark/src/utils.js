const circomlib = require("circomlib");
const snarkjs = require("snarkjs");
const fs = require("fs");
const {groth, Circuit, bigInt} = snarkjs;

const babyJub = circomlib.babyJub;
const getBasePoint = circomlib.pedersenHash.getBasePoint;



function leIntToBits(n, s) {
  x = n;
  chunks = [];
  for(let i = 0; i < s; i+=32) {
    const limb = Number(x & 0xffffffffn);
    const chunk = [limb & 0xff, limb >> 8 & 0xff, limb >> 16 & 0xff, limb >> 24];
    chunks.push([].concat(...chunk.map( x => [x&1, x&2, x&4, x&8, x&16, x&32, x&64, x&128])));
    x >>=32n;
  } 
  return [].concat(...chunks).slice(0, s);
}


function pedersenHash(bits) {
  const windowSize = 4;
  const nWindowsPerSegment = 50;
  const bitsPerSegment = windowSize*nWindowsPerSegment;

  const nSegments = Math.floor((bits.length - 1)/(windowSize*nWindowsPerSegment)) +1;

  let accP = [bigInt.zero,bigInt.one];

  for (let s=0; s<nSegments; s++) {
      let nWindows;
      if (s == nSegments-1) {
          nWindows = Math.floor(((bits.length - (nSegments - 1)*bitsPerSegment) - 1) / windowSize) +1;
      } else {
          nWindows = nWindowsPerSegment;
      }
      let escalar = bigInt.zero;
      let exp = bigInt.one;
      for (let w=0; w<nWindows; w++) {
          let o = s*bitsPerSegment + w*windowSize;
          let acc = bigInt.one;
          for (let b=0; ((b<windowSize-1)&&(o<bits.length)) ; b++) {
              if (bits[o]) {
                  acc = acc.add( bigInt.one.shl(b) );
              }
              o++;
          }
          if (o<bits.length) {
              if (bits[o]) {
                  acc = acc.neg();
              }
              o++;
          }
          escalar = escalar.add(acc.mul(exp));
          exp = exp.shl(windowSize+1);
      }

      if (escalar.lesser(bigInt.zero)) {
          escalar = babyJub.subOrder.add(escalar);
      }

      accP = babyJub.addPoint(accP, babyJub.mulPointEscalar(getBasePoint(s), escalar));
  }

  return babyJub.packPoint(accP);
}


function UTXOhasher(utxo) {
  const message = [].concat(leIntToBits(utxo.balance, 64), leIntToBits(utxo.pubkey, 253), leIntToBits(utxo.secret, 253));
  const h = pedersenHash(message);
  const hP = babyJub.unpackPoint(h);
  return hP[0];
}

function hash(v) {
  const b_v = leIntToBits(v, 253);
  return babyJub.unpackPoint(pedersenHash(b_v))[0];
}


function hash253(v) {
  const b_v = leIntToBits(v, 253);
  return babyJub.unpackPoint(pedersenHash(b_v))[0] & ((1n<<253n)-1n);
}


function compress(v1, v2) {
  const b_v = [].concat(leIntToBits(v1, 253), leIntToBits(v2, 253));
  return babyJub.unpackPoint(pedersenHash(b_v))[0];
}

function compress253(v1, v2) {
  const b_v = [].concat(leIntToBits(v1, 253), leIntToBits(v2, 253));
  return babyJub.unpackPoint(pedersenHash(b_v))[0] & ((1n<<253n)-1n);
}

function rand256() {
  n=0n;
  for(let i=0; i<9; i++) {
    const x = Math.floor(Math.random()*(1<<30));
    n = (n << 30n) + BigInt(x);
  }
  return n % (1n<<256n);
}

function unstringifyBigInts(o) {
  if ((typeof(o) == "string") && (/^[0-9]+$/.test(o) ))  {
      return BigInt(o);
  } else if (Array.isArray(o)) {
      return o.map(unstringifyBigInts);
  } else if (typeof o == "object") {
      const res = {};
      for (let k in o) {
          res[k] = unstringifyBigInts(o[k]);
      }
      return res;
  } else {
      return o;
  }
}

const fload = f=>unstringifyBigInts(JSON.parse(fs.readFileSync(f)))


function proof(input, name) {
  const circuit = new Circuit(fload(`./circuitsCompiled/${name}.json`));
  const pk = fload(`./circuitsCompiled/${name}_pk.json`);
  const witness = circuit.calculateWitness(input);
  return groth.genProof(pk, witness);
}

function verify({proof, publicSignals}, name){
  const vk = fload(`./circuitsCompiled/${name}_vk.json`);
  return groth.isValid(vk, proof, publicSignals);
}


module.exports = {UTXOhasher, compress253, hash, hash253, compress, rand256, fload, proof, verify};
