import sqlite3
import json
import pandas as pd
from datetime import datetime

# 1. Conectar à base de dados local
# Certifique-se de que o ficheiro avisa.db está na mesma pasta
conn = sqlite3.connect('server/avisa.db')
cursor = conn.cursor()

# 2. Selecionar a coluna de dados da tabela de incidentes
cursor.execute("SELECT data FROM incidents")
linhas = cursor.fetchall()

# 3. Interpretar (fazer o parse) do JSON e extrair as métricas
dados_estruturados = []

for linha in linhas:
    # A base de dados retorna uma tupla, o texto JSON está na posição 0
    incidente = json.loads(linha[0])
    
    # Extrair as informações relevantes do dicionário
    tipo = incidente.get('type')
    coordenadas = incidente.get('coordinates', {})
    lat = coordenadas.get('latitude')
    lon = coordenadas.get('longitude')
    capturado_em = coordenadas.get('capturedAt')
    
    # Só adicionamos se tiver localização e tempo válidos
    if lat is not None and lon is not None and capturado_em:
        # Converter a string de tempo (ISO 8601) para um objeto de data/hora
        # Substituímos o Z por +00:00 para facilitar a conversão no Python
        horario = datetime.fromisoformat(capturado_em.replace('Z', '+00:00'))
        
        dados_estruturados.append({
            'tipo_ocorrencia': tipo,
            'latitude': lat,
            'longitude': lon,
            'hora_do_dia': horario.hour,        # Extrai a hora (0-23) - métrica temporal
            'dia_da_semana': horario.weekday()  # 0 = Segunda, 6 = Domingo - métrica temporal
        })

conn.close()

# 4. Converter para um DataFrame (tabela) do Pandas para análise
df = pd.DataFrame(dados_estruturados)

# Mostrar a tabela gerada no terminal para interpretar os dados
print("=== DADOS EXTRAÍDOS PARA A IA ===")
print(df.head(10)) 
print("\n=== RESUMO DAS OCORRÊNCIAS ===")
print(df['tipo_ocorrencia'].value_counts())