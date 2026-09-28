// A LIKE pattern that matches `term` as a literal substring: %, _ and the
// escape character itself are escaped (Postgres' default LIKE escape is a backslash).
function likePattern(term) {
  return `%${String(term).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

module.exports = { likePattern };
