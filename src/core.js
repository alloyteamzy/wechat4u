import path from 'path'
import bl from 'bl'
import _debug from 'debug'
import FormData from 'form-data'
import mime from 'mime'
import {
  getCONF,
  Request,
  isStandardBrowserEnv,
  assert,
  getClientMsgId,
  getDeviceID
} from './util'

const debug = _debug('core')
export class AlreadyLogoutError extends Error {
  constructor (message = 'already logout') {
    super(message)
    // fuck the babel
    this.constructor = AlreadyLogoutError
    this.__proto__ = AlreadyLogoutError.prototype
  }
}

export default class WechatCore {
  constructor (data) {
    this.PROP = {
      uuid: '',
      uin: '',
      sid: '',
      skey: '',
      passTicket: '',
      formatedSyncKey: '',
      webwxDataTicket: '',
      syncKey: {
        List: []
      }
    }
    this.CONF = getCONF()
    this.COOKIE = {}
    this.user = {}
    if (data) {
      this.botData = data
    }

    this.request = new Request({
      Cookie: this.COOKIE
    })
  }

  get botData () {
    return {
      PROP: this.PROP,
      CONF: this.CONF,
      COOKIE: this.COOKIE,
      user: this.user
    }
  }

  set botData (data) {
    Object.keys(data).forEach(key => {
      Object.assign(this[key], data[key])
    })
  }

  getUUID () {
    return Promise.resolve().then(() => {
      return this.request({
        method: 'POST',
        url: this.CONF.API_jsLogin
      }).then(res => {
        let window = {
          QRLogin: {}
        }
        // res.data: "window.QRLogin.code = xxx; ..."
        // eslint-disable-next-line
        eval(res.data)
        assert.equal(window.QRLogin.code, 200, res)

        this.PROP.uuid = window.QRLogin.uuid
        return window.QRLogin.uuid
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取UUID失败'
      throw err
    })
  }

  checkLogin () {
    return Promise.resolve().then(() => {
      let params = {
        'tip': 0,
        'uuid': this.PROP.uuid,
        'loginicon': true
      }
      return this.request({
        method: 'GET',
        url: this.CONF.API_login,
        params: params
      }).then(res => {
        let window = {}

        // eslint-disable-next-line
        eval(res.data)

        assert.notEqual(window.code, 400, res)

        if (window.code === 200) {
          this.CONF = getCONF(window.redirect_uri.match(/(?:\w+\.)+\w+/)[0])
          this.rediUri = window.redirect_uri
        } else if (window.code === 201 && window.userAvatar) {
          // this.user.userAvatar = window.userAvatar
        }
        return window
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取手机确认登录信息失败'
      throw err
    })
  }

  login () {
    return Promise.resolve().then(() => {
      return this.request({
        method: 'GET',
        url: this.rediUri,
        params: {
          fun: 'new'
        }
      }).then(res => {
        let pm = res.data.match(/<ret>(.*)<\/ret>/)
        if (pm && pm[1] === '0') {
          this.PROP.skey = res.data.match(/<skey>(.*)<\/skey>/)[1]
          this.PROP.sid = res.data.match(/<wxsid>(.*)<\/wxsid>/)[1]
          this.PROP.uin = res.data.match(/<wxuin>(.*)<\/wxuin>/)[1]
          this.PROP.passTicket = res.data.match(/<pass_ticket>(.*)<\/pass_ticket>/)[1]
        }
        if (res.headers['set-cookie']) {
          res.headers['set-cookie'].forEach(item => {
            if (/webwx.*?data.*?ticket/i.test(item)) {
              this.PROP.webwxDataTicket = item.match(/=(.*?);/)[1]
            } else if (/wxuin/i.test(item)) {
              this.PROP.uin = item.match(/=(.*?);/)[1]
            } else if (/wxsid/i.test(item)) {
              this.PROP.sid = item.match(/=(.*?);/)[1]
            }
          })
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '登录失败'
      throw err
    })
  }

  init () {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'skey': this.PROP.skey,
        'r': ~new Date()
      }
      let data = {
        BaseRequest: this.getBaseRequest()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxinit,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        if (data.BaseResponse.Ret == this.CONF.SYNCCHECK_RET_LOGOUT) {
          throw new AlreadyLogoutError()
        }
        assert.equal(data.BaseResponse.Ret, 0, res)
        this.PROP.skey = data.SKey || this.PROP.skey
        this.updateSyncKey(data)
        Object.assign(this.user, data.User)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '微信初始化失败'
      throw err
    })
  }

  notifyMobile (to) {
    return Promise.resolve().then(() => {
      let params = {
        pass_ticket: this.PROP.passTicket,
        lang: 'zh_CN'
      }
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Code': to ? 1 : 3,
        'FromUserName': this.user['UserName'],
        'ToUserName': to || this.user['UserName'],
        'ClientMsgId': getClientMsgId()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxstatusnotify,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
      })
    }).catch(err => {
      debug(err)
      err.tips = '手机状态通知失败'
      throw err
    })
  }

  getContact (seq = 0) {
    return Promise.resolve().then(() => {
      let params = {
        'lang': 'zh_CN',
        'pass_ticket': this.PROP.passTicket,
        'seq': seq,
        'skey': this.PROP.skey,
        'r': +new Date()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxgetcontact,
        params: params
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)

        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取通讯录失败'
      throw err
    })
  }

  batchGetContact (contacts) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'type': 'ex',
        'r': +new Date(),
        'lang': 'zh_CN'
      }
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Count': contacts.length,
        'List': contacts
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxbatchgetcontact,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)

        return data.ContactList
      })
    }).catch(err => {
      debug(err)
      err.tips = '批量获取联系人失败'
      throw err
    })
  }

  statReport (text) {
    return Promise.resolve().then(() => {
      text = text || {
        'type': '[action-record]',
        'data': {
          'actions': [{
            'type': 'click',
            'action': '发送框',
            'time': +new Date()
          }]
        }
      }
      text = JSON.stringify(text)
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'new',
        'lang': 'zh_CN'
      }
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Count': 1,
        'List': [{
          'Text': text,
          'Type': 1
        }]
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxreport,
        params: params,
        data: data
      })
    }).catch(err => {
      debug(err)
      err.tips = '状态报告失败'
      throw err
    })
  }

  syncCheck () {
    return Promise.resolve().then(() => {
      let params = {
        'r': +new Date(),
        'sid': this.PROP.sid,
        'uin': this.PROP.uin,
        'skey': this.PROP.skey,
        'deviceid': getDeviceID(),
        'synckey': this.PROP.formatedSyncKey
      }
      return this.request({
        method: 'GET',
        url: this.CONF.API_synccheck,
        params: params
      }).then(res => {
        let window = {
          synccheck: {}
        }

        try {
          // eslint-disable-next-line
          eval(res.data)
        } catch (ex) {
          window.synccheck = { retcode: '0', selector: '0' }
        }
        if (window.synccheck.retcode == this.CONF.SYNCCHECK_RET_LOGOUT) {
          throw new AlreadyLogoutError()
        }
        assert.equal(window.synccheck.retcode, this.CONF.SYNCCHECK_RET_SUCCESS, res)
        return window.synccheck.selector
      })
    }).catch(err => {
      debug(err)
      err.tips = '同步失败'
      throw err
    })
  }

  sync () {
    return Promise.resolve().then(() => {
      let params = {
        'sid': this.PROP.sid,
        'skey': this.PROP.skey,
        'pass_ticket': this.PROP.passTicket,
        'lang': 'zh_CN'
      }
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'SyncKey': this.PROP.syncKey,
        'rr': ~new Date()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsync,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        if (data.BaseResponse.Ret == this.CONF.SYNCCHECK_RET_LOGOUT) {
          throw new AlreadyLogoutError()
        }
        assert.equal(data.BaseResponse.Ret, 0, res)

        this.updateSyncKey(data)
        this.PROP.skey = data.SKey || this.PROP.skey
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取新信息失败'
      throw err
    })
  }

  updateSyncKey (data) {
    if (data.SyncKey) {
      this.PROP.syncKey = data.SyncKey
    }
    if (data.SyncCheckKey) {
      let synckeylist = []
      for (let e = data.SyncCheckKey.List, o = 0, n = e.length; n > o; o++) {
        synckeylist.push(e[o]['Key'] + '_' + e[o]['Val'])
      }
      this.PROP.formatedSyncKey = synckeylist.join('|')
    } else if (!this.PROP.formatedSyncKey && data.SyncKey) {
      let synckeylist = []
      for (let e = data.SyncKey.List, o = 0, n = e.length; n > o; o++) {
        synckeylist.push(e[o]['Key'] + '_' + e[o]['Val'])
      }
      this.PROP.formatedSyncKey = synckeylist.join('|')
    }
  }

  logout () {
    return Promise.resolve().then(() => {
      let params = {
        redirect: 1,
        type: 0,
        skey: this.PROP.skey,
        lang: 'zh_CN'
      }

      // data加上会出错，不加data也能登出
      // let data = {
      //   sid: this.PROP.sid,
      //   uin: this.PROP.uin
      // }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxlogout,
        params: params
      }).then(res => {
        return '登出成功'
      }).catch(err => {
        debug(err)
        return '可能登出成功'
      })
    })
  }

  sendText (msg, to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.MSGTYPE_TEXT,
          'Content': msg,
          'FromUserName': this.user['UserName'],
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendmsg,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送文本信息失败'
      throw err
    })
  }

  sendEmoticon (id, to) {
    return Promise.resolve().then(() => {
      let params = {
        'fun': 'sys',
        'pass_ticket': this.PROP.passTicket,
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.MSGTYPE_EMOTICON,
          'EmojiFlag': 2,
          'FromUserName': this.user['UserName'],
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }

      if (id.indexOf('@') === 0) {
        data.Msg.MediaId = id
      } else {
        data.Msg.EMoticonMd5 = id
      }

      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendemoticon,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送表情信息失败'
      throw err
    })
  }

  // file: Stream, Buffer, File, Blob
  uploadMedia (file, filename, toUserName) {
    return Promise.resolve().then(() => {
      let name, type, size, ext, mediatype, data
      return new Promise((resolve, reject) => {
        if ((typeof (File) !== 'undefined' && file.constructor == File) ||
          (typeof (Blob) !== 'undefined' && file.constructor == Blob)) {
          name = file.name || 'file'
          type = file.type
          size = file.size
          data = file
          return resolve()
        } else if (Buffer.isBuffer(file)) {
          if (!filename) {
            return reject(new Error('文件名未知'))
          }
          name = filename
          type = mime.lookup(name)
          size = file.length
          data = file
          return resolve()
        } else if (file.readable) {
          if (!file.path && !filename) {
            return reject(new Error('文件名未知'))
          }
          name = path.basename(file.path || filename)
          type = mime.lookup(name)
          file.pipe(bl((err, buffer) => {
            if (err) {
              return reject(err)
            }
            size = buffer.length
            data = buffer
            return resolve()
          }))
        }
      }).then(() => {
        ext = name.match(/.*\.(.*)/)
        if (ext) {
          ext = ext[1].toLowerCase()
        } else {
          ext = ''
        }

        switch (ext) {
          case 'bmp':
          case 'jpeg':
          case 'jpg':
          case 'png':
            mediatype = 'pic'
            break
          case 'mp4':
            mediatype = 'video'
            break
          default:
            mediatype = 'doc'
        }

        let clientMsgId = getClientMsgId()

        let uploadMediaRequest = JSON.stringify({
          BaseRequest: this.getBaseRequest(),
          ClientMediaId: clientMsgId,
          TotalLen: size,
          StartPos: 0,
          DataLen: size,
          MediaType: 4,
          UploadType: 2,
          FromUserName: this.user.UserName,
          ToUserName: toUserName || this.user.UserName
        })

        let form = new FormData()
        form.append('name', name)
        form.append('type', type)
        form.append('lastModifiedDate', new Date().toGMTString())
        form.append('size', size)
        form.append('mediatype', mediatype)
        form.append('uploadmediarequest', uploadMediaRequest)
        form.append('webwx_data_ticket', this.PROP.webwxDataTicket)
        form.append('pass_ticket', encodeURI(this.PROP.passTicket))
        form.append('filename', data, {
          filename: name,
          contentType: type,
          knownLength: size
        })
        return new Promise((resolve, reject) => {
          if (isStandardBrowserEnv) {
            return resolve({
              data: form,
              headers: {}
            })
          } else {
            form.pipe(bl((err, buffer) => {
              if (err) {
                return reject(err)
              }
              return resolve({
                data: buffer,
                headers: form.getHeaders()
              })
            }))
          }
        })
      }).then(data => {
        let params = {
          f: 'json'
        }

        return this.request({
          method: 'POST',
          url: this.CONF.API_webwxuploadmedia,
          headers: data.headers,
          params: params,
          data: data.data
        })
      }).then(res => {
        let data = res.data
        let mediaId = data.MediaId
        assert.ok(mediaId, res)

        return {
          name: name,
          size: size,
          ext: ext,
          mediatype: mediatype,
          mediaId: mediaId
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '上传媒体文件失败'
      throw err
    })
  }

  sendPic (mediaId, to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'async',
        'f': 'json',
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.MSGTYPE_IMAGE,
          'MediaId': mediaId,
          'FromUserName': this.user.UserName,
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendmsgimg,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送图片失败'
      throw err
    })
  }

  sendVideo (mediaId, to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'async',
        'f': 'json',
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.MSGTYPE_VIDEO,
          'MediaId': mediaId,
          'FromUserName': this.user.UserName,
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendmsgvedio,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送视频失败'
      throw err
    })
  }

  sendDoc (mediaId, name, size, ext, to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'async',
        'f': 'json',
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.APPMSGTYPE_ATTACH,
          'Content': `<appmsg appid='wxeb7ec651dd0aefa9' sdkver=''><title>${name}</title><des></des><action></action><type>6</type><content></content><url></url><lowurl></lowurl><appattach><totallen>${size}</totallen><attachid>${mediaId}</attachid><fileext>${ext}</fileext></appattach><extinfo></extinfo></appmsg>`,
          'FromUserName': this.user.UserName,
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendappmsg,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送文件失败'
      throw err
    })
  }
  
  sendMiniProgram(to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'async',
        'f': 'json',
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 0,
        'Msg': {
          'Type': this.CONF.APPMSGTYPE_ATTACH,
          'Content': `<appmsg appid="" sdkver="0"><title>姐姐</title><des>大千视界Plus</des><action></action><type>33</type><showtype>0</showtype><soundtype>0</soundtype><mediatagname></mediatagname><messageext></messageext><messageaction></messageaction><content></content><contentattr>0</contentattr><url>https://mp.weixin.qq.com/mp/waerrpage?appid=wxaa16361b671fe1d7&amp;amp;type=upgrade&amp;amp;upgradetype=3#wechat_redirect</url><lowurl></lowurl><dataurl></dataurl><lowdataurl></lowdataurl><appattach><totallen>0</totallen><attachid></attachid><emoticonmd5></emoticonmd5><fileext></fileext><cdnthumburl>30590201000452305002010002046c27710102033d14b902049ce503b702045d00733c042b777875706c6f61645f777869645f38696f7a733569373376616a3132313034395f313536303331303538380204010800030201000400</cdnthumburl><cdnthumbmd5>80dae383f8bb94436fd973206ee6a7b4</cdnthumbmd5><cdnthumblength>12418</cdnthumblength><cdnthumbwidth>300</cdnthumbwidth><cdnthumbheight>240</cdnthumbheight><cdnthumbaeskey>04bfc6000e05af2e55daba3608a8eba2</cdnthumbaeskey><aeskey>04bfc6000e05af2e55daba3608a8eba2</aeskey><encryver>0</encryver><filekey>wxid_8iozs5i73vaj121055_1560313576</filekey></appattach><extinfo></extinfo><sourceusername></sourceusername><sourcedisplayname>大千视界Plus</sourcedisplayname><thumburl></thumburl><md5></md5><statextstr></statextstr><weappinfo><username></username><appid><![CDATA[wxaa16361b671fe1d7]]></appid><type>2</type><version>25</version><weappiconurl><![CDATA[http://mmbiz.qpic.cn/mmbiz_png/5H6emibhOl3Zc5MyR7wLfYMQEuem6Ns2Lh7eeql5ib1vjeiaFYFX0vvowibAQXdaEPjeFRdgpekn3hj05P2mjRwJdQ/640?wx_fmt=png&amp;wxfrom=200]]></weappiconurl><pagepath><![CDATA[pages/movies_info/movieInfo.html?id=fc9a3963-7210-3bce-f385-28115a99c69d&amp;vid=350ae7ee-c52f-8282-7a47-ecb0f48eb76d&amp;type=6&amp;aid=f7faf837-c700-ca3a-c64f-82c31ff1011a&amp;origin_uid=09b5e7ca-7a27-d81f-2585-0ef70aeb223f&amp;nick=赵源]]></pagepath><shareId><![CDATA[0_wxaa16361b671fe1d7_1814524161_1560313575_0]]></shareId><appservicetype>0</appservicetype></weappinfo></appmsg>`,
          'FromUserName': this.user.UserName,
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxsendappmsg,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '发送文件失败'
      throw err
    })
  }

  forwardMsg (msg, to) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'fun': 'async',
        'f': 'json',
        'lang': 'zh_CN'
      }
      let clientMsgId = getClientMsgId()
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Scene': 2,
        'Msg': {
          'Type': msg.MsgType,
          'MediaId': '',
          'Content': msg.Content.replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          'FromUserName': this.user.UserName,
          'ToUserName': to,
          'LocalID': clientMsgId,
          'ClientMsgId': clientMsgId
        }
      }
      let url, pm
      switch (msg.MsgType) {
        case this.CONF.MSGTYPE_TEXT:
          url = this.CONF.API_webwxsendmsg
          if (msg.SubMsgType === this.CONF.MSGTYPE_LOCATION) {
            data.Msg.Type = this.CONF.MSGTYPE_LOCATION
            data.Msg.Content = msg.OriContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          }
          break
        case this.CONF.MSGTYPE_IMAGE:
          url = this.CONF.API_webwxsendmsgimg
          break
        case this.CONF.MSGTYPE_EMOTICON:
          url = this.CONF.API_webwxsendemoticon
          params.fun = 'sys'
          data.Msg.EMoticonMd5 = msg.Content.replace(/^[\s\S]*?md5\s?=\s?"(.*?)"[\s\S]*?$/, '$1')
          if (!data.Msg.EMoticonMd5) {
            throw new Error('商店表情不能转发')
          }
          data.Msg.EmojiFlag = 2
          data.Scene = 0
          delete data.Msg.MediaId
          delete data.Msg.Content
          break
        case this.CONF.MSGTYPE_MICROVIDEO:
        case this.CONF.MSGTYPE_VIDEO:
          url = this.CONF.API_webwxsendmsgvedio
          data.Msg.Type = this.CONF.MSGTYPE_VIDEO
          break
        case this.CONF.MSGTYPE_APP:
          url = this.CONF.API_webwxsendappmsg
          data.Msg.Type = msg.AppMsgType
          data.Msg.Content = data.Msg.Content.replace(
            /^[\s\S]*?(<appmsg[\s\S]*?<attachid>)[\s\S]*?(<\/attachid>[\s\S]*?<\/appmsg>)[\s\S]*?$/,
            `$1${msg.MediaId}$2`)
          break
        default:
          throw new Error('该消息类型不能直接转发')
      }
      return this.request({
        method: 'POST',
        url: url,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '转发消息失败'
      throw err
    })
  }

  getMsgImg (msgId) {
    return Promise.resolve().then(() => {
      let params = {
        MsgID: msgId,
        skey: this.PROP.skey,
        type: 'big'
      }

      return this.request({
        method: 'GET',
        url: this.CONF.API_webwxgetmsgimg,
        params: params,
        responseType: 'arraybuffer'
      }).then(res => {
        return {
          data: res.data,
          type: res.headers['content-type']
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取图片或表情失败'
      throw err
    })
  }

  getVideo (msgId) {
    return Promise.resolve().then(() => {
      let params = {
        MsgID: msgId,
        skey: this.PROP.skey
      }

      return this.request({
        method: 'GET',
        url: this.CONF.API_webwxgetvideo,
        headers: {
          'Range': 'bytes=0-'
        },
        params: params,
        responseType: 'arraybuffer'
      }).then(res => {
        return {
          data: res.data,
          type: res.headers['content-type']
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取视频失败'
      throw err
    })
  }

  getVoice (msgId) {
    return Promise.resolve().then(() => {
      let params = {
        MsgID: msgId,
        skey: this.PROP.skey
      }

      return this.request({
        method: 'GET',
        url: this.CONF.API_webwxgetvoice,
        params: params,
        responseType: 'arraybuffer'
      }).then(res => {
        return {
          data: res.data,
          type: res.headers['content-type']
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取声音失败'
      throw err
    })
  }

  getHeadImg (HeadImgUrl) {
    return Promise.resolve().then(() => {
      let url = this.CONF.origin + HeadImgUrl
      return this.request({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer'
      }).then(res => {
        return {
          data: res.data,
          type: res.headers['content-type']
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取头像失败'
      throw err
    })
  }

  getDoc (FromUserName, MediaId, FileName) {
    return Promise.resolve().then(() => {
      let params = {
        sender: FromUserName,
        mediaid: MediaId,
        filename: FileName,
        fromuser: this.user.UserName,
        pass_ticket: this.PROP.passTicket,
        webwx_data_ticket: this.PROP.webwxDataTicket
      }
      return this.request({
        method: 'GET',
        url: this.CONF.API_webwxdownloadmedia,
        params: params,
        responseType: 'arraybuffer'
      }).then(res => {
        return {
          data: res.data,
          type: res.headers['content-type']
        }
      })
    }).catch(err => {
      debug(err)
      err.tips = '获取文件失败'
      throw err
    })
  }

  verifyUser (UserName, Ticket) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'lang': 'zh_CN'
      }
      let data = {
        'BaseRequest': this.getBaseRequest(),
        'Opcode': 3,
        'VerifyUserListSize': 1,
        'VerifyUserList': [{
          'Value': UserName,
          'VerifyUserTicket': Ticket
        }],
        'VerifyContent': '',
        'SceneListCount': 1,
        'SceneList': [33],
        'skey': this.PROP.skey
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxverifyuser,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '通过好友请求失败'
      throw err
    })
  }

  /**
   * 添加好友
   * @param UserName 待添加用户的UserName
   * @param content
   * @returns {Promise.<TResult>}
   */
  addFriend (UserName, content = '我是' + this.user.NickName) {
    let params = {
      'pass_ticket': this.PROP.passTicket,
      'lang': 'zh_CN'
    }

    let data = {
      'BaseRequest': this.getBaseRequest(),
      'Opcode': 2,
      'VerifyUserListSize': 1,
      'VerifyUserList': [{
        'Value': UserName,
        'VerifyUserTicket': ''
      }],
      'VerifyContent': content,
      'SceneListCount': 1,
      'SceneList': [33],
      'skey': this.PROP.skey
    }

    return this.request({
      method: 'POST',
      url: this.CONF.API_webwxverifyuser,
      params: params,
      data: data
    }).then(res => {
      let data = res.data
      assert.equal(data.BaseResponse.Ret, 0, res)
      return data
    }).catch(err => {
      debug(err)
      err.tips = '添加好友失败'
      throw err
    })
  }

  // Topic: Chatroom name
  // MemberList format:
  // [
  //   {"UserName":"@250d8d156ad9f8b068c2e3df3464ecf2"},
  //   {"UserName":"@42d725733741de6ac53cbe3738d8dd2e"}
  // ]
  createChatroom (Topic, MemberList) {
    return Promise.resolve().then(() => {
      let params = {
        'pass_ticket': this.PROP.passTicket,
        'lang': 'zh_CN',
        'r': ~new Date()
      }
      let data = {
        BaseRequest: this.getBaseRequest(),
        MemberCount: MemberList.length,
        MemberList: MemberList,
        Topic: Topic
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxcreatechatroom,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '创建群失败'
      throw err
    })
  }

  // fun: 'addmember' or 'delmember' or 'invitemember'
  updateChatroom (ChatRoomUserName, MemberList, fun) {
    return Promise.resolve().then(() => {
      let params = {
        fun: fun
      }
      let data = {
        BaseRequest: this.getBaseRequest(),
        ChatRoomName: ChatRoomUserName
      }
      if (fun === 'addmember') {
        data.AddMemberList = MemberList.toString()
      } else if (fun === 'delmember') {
        data.DelMemberList = MemberList.toString()
      } else if (fun === 'invitemember') {
        data.InviteMemberList = MemberList.toString()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxupdatechatroom,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '邀请或踢出群成员失败'
      throw err
    })
  }

  // OP: 1 联系人置顶 0 取消置顶
  // 若不传RemarkName，则会覆盖以设置的联系人备注名
  opLog (UserName, OP, RemarkName) {
    return Promise.resolve().then(() => {
      let params = {
        pass_ticket: this.PROP.passTicket
      }
      let data = {
        BaseRequest: this.getBaseRequest(),
        CmdId: 3,
        OP: OP,
        RemarkName: RemarkName,
        UserName: UserName
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxoplog,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '置顶或取消置顶失败'
      throw err
    })
  }

  updateRemarkName (UserName, RemarkName) {
    return Promise.resolve().then(() => {
      let params = {
        pass_ticket: this.PROP.passTicket,
        'lang': 'zh_CN'
      }
      let data = {
        BaseRequest: this.getBaseRequest(),
        CmdId: 2,
        RemarkName: RemarkName,
        UserName: UserName
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxoplog,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      err.tips = '设置用户标签失败'
      throw err
    })
  }

  updateChatRoomName (ChatRoomUserName, NewName) {
    return Promise.resolve().then(() => {
      let params = {
        'fun': 'modtopic'
      }
      let data = {
        BaseRequest: this.getBaseRequest(),
        ChatRoomName: ChatRoomUserName,
        NewTopic: NewName
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxupdatechatroom,
        params: params,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
      })
    }).catch(err => {
      debug(err)
      throw new Error('更新群名失败')
    })
  }

  revokeMsg (msgId, toUserName) {
    return Promise.resolve().then(() => {
      let data = {
        BaseRequest: this.getBaseRequest(),
        SvrMsgId: msgId,
        ToUserName: toUserName,
        ClientMsgId: getClientMsgId()
      }
      return this.request({
        method: 'POST',
        url: this.CONF.API_webwxrevokemsg,
        data: data
      }).then(res => {
        let data = res.data
        assert.equal(data.BaseResponse.Ret, 0, res)
        return data
      })
    }).catch(err => {
      debug(err)
      throw new Error('撤回消息失败')
    })
  }

  getBaseRequest () {
    return {
      Uin: parseInt(this.PROP.uin),
      Sid: this.PROP.sid,
      Skey: this.PROP.skey,
      DeviceID: getDeviceID()
    }
  }
}
