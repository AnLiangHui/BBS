
module.exports = function () {
  var sessionMap = Object.create(null)

  return async (req, res, next) => {
    if (req.cookies.sessionId) {
      let sid = req.cookies.sessionId
      if (sid in sessionMap) {
        req.session = sessionMap[sid]
      } else {
        req.session = sessionMap[sid] = {}
      }
    } else {
      let sid = Math.random().toString(16).slice(2)
      res.cookie('sessionId', sid, { maxAge: 864000000 })
      req.session = sessionMap[sid] = {}
    }
    next()
  }
}
