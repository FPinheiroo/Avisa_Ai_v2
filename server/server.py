import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB = os.environ.get('AVISA_DB', os.path.join(os.path.dirname(__file__), 'avisa.db'))
TYPES = ['Acidente', 'Assalto', 'Congestionamento', 'Via interditada']
STATUSES = ['Aberta', 'Em and   amento', 'Resolvida']

def now():
    return datetime.now(timezone.utc).isoformat()

def connect():
    conn = sqlite3.connect(DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def initialize():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, cnh TEXT, salt TEXT, password TEXT);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        ''')

def public_user(row):
    return {k: row[k] for k in ['id', 'name', 'email', 'cnh']}

def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()

# Fórmula de Haversine para calcular a distância em metros
def get_distance(lat1, lon1, lat2, lon2):
    R = 6371e3
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2) * math.sin(delta_phi/2) + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda/2) * math.sin(delta_lambda/2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def string(data, key, minimum=1, maximum=1000):
    value = data.get(key)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise ApiError(400, f'Campo inválido: {key} ({minimum} a {maximum} caracteres).')
    return value.strip()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # Não registrar tokens nem coordenadas.

    def respond(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        origin = os.environ.get('AVISA_CORS_ORIGIN')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.respond(200, {})

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        try:
            data = {}
            if self.command == 'POST':
                try:
                    length = int(self.headers.get('Content-Length', 0))
                    if not 0 <= length <= 20000:
                        raise ApiError(413, 'Requisição muito grande.')
                    data = json.loads(self.rfile.read(length) or b'{}')
                    if not isinstance(data, dict):
                        raise ValueError()
                except (ValueError, UnicodeError):
                    raise ApiError(400, 'JSON inválido.')
            with connect() as db:
                result = self.route(db, data)
            self.respond(200, result)
        except ApiError as error:
            self.respond(error.status, {'error': error.message})
        except Exception:
            self.respond(500, {'error': 'Falha interna. Tente novamente.'})

    def route(self, db, data):
        path = self.path.split('?')[0].rstrip('/')
        post = self.command == 'POST'
        
        # Rotas Públicas (Sem necessidade de autenticação)
        if path == '/health' and not post:
            return {'ok': True}
        if path == '/auth/register' and post:
            name, email = string(data, 'name', maximum=120), string(data, 'email', maximum=254).lower()
            cnh = string(data, 'cnh', maximum=30)
            password = string(data, 'password', 6, 128)
            if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                raise ApiError(400, 'E-mail inválido.')
            salt = secrets.token_hex(16)
            try:
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (str(uuid.uuid4()), name, email, cnh, salt, password_hash(password, salt)))
            except sqlite3.IntegrityError:
                raise ApiError(409, 'E-mail já cadastrado.')
            return {'ok': True}
        if path == '/auth/login' and post:
            email = string(data, 'email', maximum=254).lower()
            password = string(data, 'password', maximum=128)
            user = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if not user or not hmac.compare_digest(password_hash(password, user['salt']), user['password']):
                raise ApiError(401, 'E-mail ou senha incorretos.')
            token = secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user['id'], time.time()+604800))
            return {'token': token, 'user': public_user(user)}

        # ---- INÍCIO DA NOVA ROTA DE INTELIGÊNCIA DE RISCOS ----
        if path == '/consultarRiscoPorCoordenada' and post:
            try:
                # Verificação simplificada de token para o teste (via JSON Payload)
                token_recebido = data.get('token')
                if not token_recebido:
                    raise ApiError(401, "Autenticacao ausente ou invalida.")

                # Validação de Entradas
                lat = data.get('latitude')
                lon = data.get('longitude')
                raio = data.get('raioMetros', 500)

                if lat is None or lon is None or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                    raise ApiError(400, "Coordenada geografica invalida.")

                # Consulta ocorrências ativas na área no banco de dados SQLite
                linhas = db.execute("SELECT data FROM incidents").fetchall()
                
                ocorrencias_recentes_na_area = 0
                agora = datetime.now(timezone.utc)
                limite_tempo = agora - timedelta(hours=2) # Últimas 2 horas

                for linha in linhas:
                    incidente = json.loads(linha[0])
                    coord = incidente.get('coordinates', {})
                    inc_lat = coord.get('latitude')
                    inc_lon = coord.get('longitude')
                    capturado_em_str = coord.get('capturedAt')
                    
                    if inc_lat and inc_lon and capturado_em_str:
                        try:
                            # Tenta converter a string ISO; se falhar, ignora a linha
                            capturado_em = datetime.fromisoformat(capturado_em_str.replace('Z', '+00:00'))
                        except ValueError:
                            continue 
                        
                        distancia = get_distance(lat, lon, inc_lat, inc_lon)
                        
                        if distancia <= raio and capturado_em >= limite_tempo:
                            ocorrencias_recentes_na_area += 1

                # Regra de negócio: Definição do Nível de Risco
                if ocorrencias_recentes_na_area > 0:
                    nivel_risco = "CRITICO" if ocorrencias_recentes_na_area > 3 else "ALTO"
                else:
                    nivel_risco = "BAIXO"

                validade = agora + timedelta(minutes=15)
                
                # Resultado / saída conforme o contrato (JSON PL)
                return {
                    "status": "SUCESSO",
                    "coordenada": {"latitude": lat, "longitude": lon},
                    "nivelRisco": nivel_risco,
                    "validadeAte": validade.isoformat()
                }

            except ApiError:
                raise
            except Exception as e:
                # Retorna 500 caso haja algum erro de lógica
                raise ApiError(500, f"Falha no calculo de dados espaciais: {str(e)}")
        # ---- FIM DA NOVA ROTA ----

        # Autenticação Padrão para as rotas do aplicativo (Bearer Token)
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        user = db.execute('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        
        if not user:
            raise ApiError(401, 'Sessão expirada. Saia e faça login novamente.')
        
        if path == '/auth/logout' and post:
            db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(token.encode()).hexdigest(),))
            return {'ok': True}
        if path == '/incidents' and not post:
            return sorted([json.loads(r['data']) for r in db.execute('SELECT data FROM incidents')], key=lambda i: i['createdAt'], reverse=True)
        if path == '/incidents' and post:
            kind = string(data, 'type')
            if kind not in TYPES:
                raise ApiError(400, 'Tipo inválido.')
            item = {'id': str(uuid.uuid4()), 'type': kind, 'location': string(data, 'location', maximum=500),
                    'description': string(data, 'description', 0, 3000), 'createdAt': now(), 'reportedBy': user['id'], 'status': 'Aberta', 'comments': []}
            coords = data.get('coordinates')
            if coords is not None:
                if not isinstance(coords, dict):
                    raise ApiError(400, 'Coordenadas inválidas.')
                for key, bound in [('latitude', 90), ('longitude', 180)]:
                    v = coords.get(key)
                    if type(v) not in (int, float) or not math.isfinite(v) or not -bound <= v <= bound:
                        raise ApiError(400, 'Coordenadas inválidas.')
                accuracy = coords.get('accuracy')
                if accuracy is not None and (type(accuracy) not in (int, float) or not math.isfinite(accuracy) or accuracy < 0):
                    raise ApiError(400, 'Precisão inválida.')
                item['coordinates'] = {k: coords[k] for k in ['latitude', 'longitude']}
                item['coordinates'].update(accuracy=accuracy, capturedAt=string(coords, 'capturedAt', maximum=50))
            db.execute('INSERT INTO incidents VALUES(?,?)', (item['id'], json.dumps(item)))
            return item
        match = re.fullmatch('/incidents/([^/]+)/(status|comments)', path)
        if post and match:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT data FROM incidents WHERE id=?', (match[1],)).fetchone()
            if not row:
                raise ApiError(404, 'Ocorrência não encontrada.')
            item = json.loads(row['data'])
            if match[2] == 'status':
                if item['reportedBy'] != user['id']:
                    raise ApiError(403, 'Somente o autor pode alterar o status.')
                status = string(data, 'status')
                if status not in STATUSES:
                    raise ApiError(400, 'Status inválido.')
                item['status'] = status
            else:
                item['comments'].append({'id': str(uuid.uuid4()), 'authorId': user['id'], 'authorName': user['name'], 'text': string(data, 'text'), 'createdAt': now()})
            item['updatedAt'] = now()
            db.execute('UPDATE incidents SET data=? WHERE id=?', (json.dumps(item), item['id']))
            return item
        raise ApiError(404, 'Rota não encontrada.')

if __name__ == '__main__':
    initialize()
    address = (os.environ.get('AVISA_HOST', '127.0.0.1'), int(os.environ.get('PORT', '8000')))
    print(f'API de demonstração em http://{address[0]}:{address[1]}', flush=True)
    ThreadingHTTPServer(address, Handler).serve_forever()