let i = 0;
let o = {
  get p() {
    return [i, i];
  }
};
let r;
r = o.p[i = 1];