const path = require('path')
const express = require('express')
const cookieParser = require('cookie-parser')
const sqlite = require('sqlite')
const sqlite3 = require('sqlite3')
const svgCaptcha = require('svg-captcha')
const formidable = require('formidable')
const sessionMiddleware = require('./session-middleware')
const md5 = require('md5')
// const nodeMailer = require('nodemailer');

// // POP3 SMTP IMAP
// var transporter = nodeMailer.createTransport({
//   host: 'smtp.qq.com',
//   port: 587,
//   secure: false,
//   requireTLS: true,
//   auth: {
//     user: 'Enter your email address',
//     pass: 'Enter your emaill password'
//   }
// });


svgCaptcha.options.width = 80
svgCaptcha.options.height = 30
svgCaptcha.options.fontSize = 32
svgCaptcha.options.charPreset = '0123456789'



const port = 8006

const app = express()

let db
(async function () {
  db = await sqlite.open({
    filename: path.join(__dirname, 'bbs.db'),
    driver: sqlite3.Database,
  })
}())



// 设置模板文件夹的位置
app.set('views', path.join(__dirname, 'templates'))

// 设置对应扩展名的模板文件所使用的模板引擎
// app.engine('hbs', require('hbs').__express)

// 设置pug输出格式化过的html
app.locals.pretty = true


app.use((req, res, next) => {
  console.log(req.method, req.url, req.cookies, req.signedCookies)
  next()
  // res.render('test.hbs', {name: 'world'})
})

// app.use((req, res, next) => {
//   用于查看文件上传时浏览器发送的数据格式
//   if (req.is('multipart')) {
//     req.on('data', (data) => {
//       console.log(data.toString())
//     })
//     req.on('end', () => {
//       next()
//     })
//   } else {
//     next()
//   }
// })

app.use(cookieParser('jafoiwejofiweurower'))

// http://bbs.com/register.html
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'static')))
app.use('/upload', express.static(path.join(__dirname, 'upload')))


app.use(sessionMiddleware())

// 用来通过cookie从数据库里查询到当前登陆用户的
app.use(async (req, res, next) => {
  if (req.signedCookies.loginUser) {
    req.user = await db.get('SELECT rowid AS id, * FROM users WHERE email = ?', req.signedCookies.loginUser)
  } else {
    req.user = null
  }
  next()
})

const form = formidable({
  multiples: true,
  keepExtensions: true,
  uploadDir: path.join(__dirname, 'upload')
});

app.get('/register', (req, res, next) => {
  res.render('register.pug')
})
app.post('/register', async (req, res, next) => {
  form.parse(req, async (err, info, files) => {
    let salt = Math.random().toString(16).slice(2, 8)
    try {
      var stmtResult = await db.run(
        `INSERT INTO users (email, password, salt, gender, avatar, createAt) values (?,?,?,?,?,?)`,
        info.email, md5(md5(info.password) + md5(salt)), salt, info.gender, path.basename(files.avatar.path), new Date().toISOString()
      )
      res.end('register success')
    } catch (e) {
      if (e.code == 'SQLITE_CONSTRAINT') {
        res.end('register failed')
      } else {
        next(e)
      }
    }
  })
})


//   /?p=2
app.get('/', async (req, res, next) => {
  let page = Number(req.query.p ?? '1')
  let size = 6
  let posts = await db.all(`
    SELECT posts.rowid AS id, posts.*, users.email, users.avatar
      FROM posts JOIN users
      ON posts.userId = users.rowid
      ORDER BY createAt DESC
      LIMIT ?, ?
  `, (page - 1) * size, size)
  let postCount = await db.get(`SELECT count(*) as count FROM posts`)

  res.render('index.pug', {
    posts: posts,
    user: req.user,
    pages: {
      pageSize: size,
      pageCount: Math.ceil(postCount.count / size),
      currPage: page
    }
  })
})

app.get('/post', async (req, res, next) => {
  res.render('add-post.pug', {
    user: req.user
  })
})

app.post('/post', async (req, res, next) => {
  var info = req.body
  if (req.user) {
    let stmt = await db.run(
      'INSERT INTO posts VALUES (?,?,?,?)',
      info.title, info.detail, req.user.id, new Date().toISOString()
    )
    res.redirect('/post/' + stmt.lastID)//刚刚插入的一行的id
  } else {
    res.end('user not login!')
  }
})




app.get('/post/:id', async (req, res, next) => {
  var post = await db.get(`SELECT rowid AS id, * FROM posts WHERE id = ?`, req.params.id)
  if (post) {
    var comments = await db.all(`SELECT comments.rowid AS id,comments.createAt as commetTime, * FROM comments JOIN users ON userId = users.rowid WHERE postId = ?`, req.params.id)
    res.render('post.pug', {
      post: post,
      comments: comments,
      user: req.user,
    })
  } else {
    res.status(404).end('您要找的主题不存在')
  }
})
app.get('/post/:id/delete', async (req, res, next) => {
  if (req.user) {
    var postInfo = await db.get('SELECT * FROM posts WHERE rowid = ?', req.params.id)
    if (postInfo) {
      if (postInfo.userId == req.user.id) {
        await db.run('DELETE FROM posts WHERE rowid = ?', req.params.id)
        res.redirect(req.get('referer'))
      } else {
        res.status(401).end('not your post')
      }
    } else {
      res.end()
    }
  } else {
    res.status(401).end('no login')
  }
})

app.get('/user/:id', async (req, res, next) => {
  var userId = req.params.id

  var currUser = await db.get('SELECT * FROM users WHERE rowid = ?', userId)
  if (currUser) {
    var posts = await db.all('SELECT * FROM posts JOIN users ON userId = users.rowid WHERE userId = ? ', userId)
    var comments = await db.all('SELECT *, comments.detail as comment FROM comments JOIN posts ON postId = posts.rowid WHERE comments.userId = ?', userId)

    res.render('user-profile.pug', {
      user: req.user,//当前登陆用户
      currUser: currUser,//正在查看的用户的信息
      posts: posts,//该用户发过的帖子
      comments: comments,//用户回过的帖子
    })
  } else {
    res.status(404).end('404 no user')
  }
})

app.get('/change-profile', async (req, res, next) => {
  if (req.user) {
    res.render('change-profile.pug', {
      user: req.user
    })
  } else {
    res.end('no login')
  }
})

app.post('/change-profile', async (req, res, next) => {
  if (req.user) {//确定有用户登陆
    form.parse(req, async (err, fields, files) => {
      await db.run(
        'UPDATE users SET password = ?, avatar = ?, gender = ? WHERE rowid = ?',
        md5(md5(fields.password) + md5(req.user.salt)), path.basename(files.avatar.path), fields.gender, req.user.id
      )

      res.end('change profile ok')
    })
  } else {
    res.end('no login')
  }
})

app.post('/comment', async (req, res, next) => {
  if (req.user) {// 有用户登陆
    var comment = req.body
    await db.run(
      'INSERT INTO comments VALUES (?,?,?,?)',
      comment.detail, req.user.id, comment.postId, new Date().toISOString()
    )
    res.redirect(req.get('referer'))
  } else {
    res.end('not login!')
  }
})

app.get('/captcha', async (req, res, next) => {
  console.log(req.session)

  var obj = svgCaptcha.create({
    ignoreChars: '0oil1',
    noise: 3,
  })

  req.session.captcha = obj.text

  res.type('image/svg+xml').end(obj.data)
})

app.get('/login', (req, res, next) => {
  res.render('login.pug', {
    referer: req.get('referer')
  })
})
app.post('/login', async (req, res, next) => {
  let loginInfo = req.body
  if (loginInfo.captcha == req.session.captcha) {
    let user = await db.get(
      'SELECT * FROM users WHERE email = ?',
      loginInfo.email
    )
    if (user) {
      if (user.password != md5(md5(loginInfo.password) + md5(user.salt))) {
        res.status(401).json({
          code: -1,
          msg: '用户名或密码错误'
        })
        return
      }
      res.cookie('loginUser', user.email, {
        maxAge: 3 * 60 * 60 * 1000,
        signed: true
      })
      // res.end()
      res.redirect(loginInfo.next ?? '/')
    } else {
      // 401 un authorized
      res.status(401).json({
        code: -1,
        msg: '用户名或密码错误'
      })
    }
  } else {
    res.status(401).json({
      code: -1,
      msg: '验证码错误'
    })
  }
})

const changePasswordMap = Object.create(null)
app.get('/forgot', (req, res, next) => {
  res.render('forgot.pug')
})
app.post('/forgot', async (req, res, next) => {
  var email = req.body.email
  var id = Math.random().toString(16).slice(2)
  var url = 'http://localhost:8006/forgot/' + id

  console.log(url)// http://localhost:8006/forgot/9283749237498237

  changePasswordMap[id] = email
  setTimeout(() => {
    delete changePasswordMap[id]
  }, 1000 * 60 * 10)

  res.end('please see your inbox')
  // sendEmail(email, '请点击正文中的链接修改密码', '您好，请点击链接修改密码：' + url)
})
app.get('/forgot/:token', async (req, res, next) => {
  var token = req.params.token
  if (token in changePasswordMap) {
    var email = changePasswordMap[token]
    var user = await db.get('SELECT * FROM users WHERE email = ?', email)
    res.render('forgot-change.pug', {
      user,
    })
  } else {
    res.end('链接已失效')
  }
})
app.post('/forgot/:token', async (req, res, next) => {
  var token = req.params.token
  if (token in changePasswordMap) {
    var email = changePasswordMap[token]
    var salt = Math.random().toString(16).substr(2, 6)
    await db.run('UPDATE users SET password = ?, salt = ? WHERE email = ?',
      md5(md5(req.body.password) + md5(salt)), salt, email
    )
    res.end('修改成功')
  } else {
    res.end('链接已失效')
  }
})

app.get('/logout', (req, res, next) => {
  res.clearCookie('loginUser')
  res.redirect(req.get('referer'))
})

app.listen(port, () => {
  console.log('listening on port', port)
})
