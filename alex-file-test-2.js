const appName = 'ALEX';
const version = '3.0.0';
function getStatus() {
  return 'ALEX_FILE_TEST_OK';
}
function getInfo() {
  return { appName, version, status: getStatus() };
}
const info = getInfo();
console.log(info.appName);
console.log(info.version);
console.log(info.status);
module.exports = { getStatus, getInfo };