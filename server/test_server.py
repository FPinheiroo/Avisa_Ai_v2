import concurrent.futures, json, os, tempfile, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
import server

class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = os.path.join(cls.temp.name, 'test.db'); server.initialize()
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.url = f'http://127.0.0.1:{cls.http.server_port}'
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.temp.cleanup()
    def api(self, path, body=None, token=None):
        headers = {'Content-Type':'application/json'}
        if token: headers['Authorization'] = 'Bearer '+token
        req = urllib.request.Request(self.url+path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)
    def test_shared_flow_and_permissions(self):
        self.assertEqual(self.api('/incidents')[0], 401)
        for name in ('Ana', 'Bruno'):
            self.assertEqual(self.api('/auth/register', {'name':name,'email':name+'@test.com','password':'senha123','cnh':'123'})[0], 200)
        self.assertEqual(self.api('/auth/login', {'email':'Ana@test.com','password':'errada'})[0], 401)
        a = self.api('/auth/login', {'email':'Ana@test.com','password':'senha123'})[1]
        b = self.api('/auth/login', {'email':'Bruno@test.com','password':'senha123'})[1]
        self.assertNotIn('password', a['user'])
        payload = {'type':'Acidente','location':'Av. Paulista','description':'Teste','reportedBy':b['user']['id'], 'coordinates': {'latitude':-23.5,'longitude':-46.6,'accuracy':15,'capturedAt':server.now()}}
        status, item = self.api('/incidents', payload, a['token'])
        self.assertEqual(status, 200); self.assertEqual(item['reportedBy'], a['user']['id']); self.assertEqual(item['status'], 'Aberta')
        prefix = '/incidents/'+item['id']
        self.assertEqual(self.api(prefix+'/status', {'status':'Resolvida'}, b['token'])[0], 403)
        self.assertEqual(self.api(prefix+'/status', {'status':'Inválida'}, a['token'])[0], 400)
        for text in ('  ', 'x'*1001): self.assertEqual(self.api(prefix+'/comments', {'text':text}, b['token'])[0], 400)
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda i:self.api(prefix+'/comments', {'text':f'Atualização {i}', 'authorName':'Falso'}, b['token']), range(5)))
        self.assertTrue(all(s == 200 for s,_ in results))
        result = self.api(prefix+'/status', {'status':'Resolvida'}, a['token'])[1]
        self.assertEqual(len(result['comments']),5); self.assertTrue(all(c['authorName']=='Bruno' for c in result['comments']))
        self.assertEqual(self.api('/incidents',token=b['token'])[1][0]['status'],'Resolvida')
        with server.connect() as db: self.assertEqual(len(json.loads(db.execute('SELECT data FROM incidents').fetchone()[0])['comments']),5)
        payload['coordinates']['latitude']=100
        self.assertEqual(self.api('/incidents',payload,a['token'])[0],400)
        self.assertEqual(self.api('/auth/logout',{},b['token'])[0],200)
        self.assertEqual(self.api('/incidents',token=b['token'])[0],401)
if __name__ == '__main__': unittest.main(verbosity=2)
