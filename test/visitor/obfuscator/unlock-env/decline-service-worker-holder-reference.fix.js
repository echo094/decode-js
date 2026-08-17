(function () {
  var holder = typeof global === 'object' ? global : this;
  holder.keepAlive = true;
})();
console.log('service-worker-boundary');
