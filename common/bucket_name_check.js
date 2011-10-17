/*
  Rules:
    1. no capital letters (to be able to use virtual host)
    2. starting with lower case letters or numbers
    3. 3 ~ 63 chars
    4. no "_"
    5. no "/"
    6. no ".."
    7. no "-." or ".-"
    8. no IP address
    9. no trailing "-"
*/
module.exports.is_valid_name = function (name)
{
  if (name.length < 3 || name.length > 63) { return false; }
  if (name.match(/\.\.|-\.|\.-|_/) !== null) { return false; }
  if (name.match(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/) !== null) { return false; }
  if (name.match(/^[a-z0-9]/) === null) { return false; }
  if (name.match(/[A-Z]/) !== null) { return false; }
  if (name.match(/\/|\\/) !== null) { return false; }
  if (name.match(/-$/) !== null) { return false; }
  return true;
};
