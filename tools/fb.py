import json,urllib.request,urllib.parse,sys
PREFS=sys.argv[1] if len(sys.argv)>1 else '/mnt/user-data/uploads/AileAjandasi/data/prefs.json'
p=json.load(open(PREFS)); cfg=json.loads(p['sync'])
KEY=cfg['apiKey']; PID=cfg['projectId']; FID=cfg['fid']
BASE=f'https://firestore.googleapis.com/v1/projects/{PID}/databases/(default)/documents'
def token():
    r=urllib.request.urlopen(urllib.request.Request('https://securetoken.googleapis.com/v1/token?key='+KEY, data=urllib.parse.urlencode({'grant_type':'refresh_token','refresh_token':p['refresh']}).encode(), headers={'Content-Type':'application/x-www-form-urlencoded'}))
    return json.load(r)['id_token']
def req(method,url,body=None,tok=None):
    h={'Content-Type':'application/json'}
    if tok: h['Authorization']='Bearer '+tok
    try:
        r=urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method))
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
