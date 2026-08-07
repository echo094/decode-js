const __p_dlrArray = ["myKey"];
var myObject = {
  [__p_dlrArray[0]]: 100
};
var myObject2 = {
  [__p_dlrArray[0]]: 50
};
console.log(myObject[__p_dlrArray[0]], myObject2[__p_dlrArray[0]]);