import * as Location from 'expo-location';
import { API_URL, request, setToken } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const STORAGE = {
  users: '@vigilanse/users',
  session: API_URL ? `@avisa-ai/session/${API_URL}` : '@vigilanse/session',
  incidents: '@vigilanse/incidents',
};

const COLORS = {
  navy: '#102A43',
  blue: '#176B87',
  cyan: '#1D9CB5',
  background: '#F4F7FA',
  white: '#FFFFFF',
  text: '#1F2933',
  muted: '#6B7C8F',
  border: '#DDE5EC',
  red: '#D64545',
};

type User = {
  id: string;
  name: string;
  email: string;
  password?: string;
  cnh: string;
};

type IncidentType = 'Acidente' | 'Assalto' | 'Congestionamento' | 'Via interditada';

type IncidentStatus = 'Aberta' | 'Em andamento' | 'Resolvida';
type Comment = { id: string; authorId: string; authorName: string; text: string; createdAt: string };
type Coordinates = { latitude: number; longitude: number; accuracy: number | null; capturedAt: string };
const STATUSES: IncidentStatus[] = ['Aberta', 'Em andamento', 'Resolvida'];
type Incident = {
  id: string;
  type: IncidentType;
  location: string;
  description: string;
  createdAt: string;
  reportedBy: string;
  status: IncidentStatus;
  comments: Comment[];
  coordinates?: Coordinates;
  updatedAt?: string;
};

type AuthMode = 'login' | 'register';
type Tab = 'home' | 'report' | 'alerts' | 'profile';

const INCIDENT_TYPES: Array<{ label: IncidentType; icon: string }> = [
  { label: 'Acidente', icon: '💥' },
  { label: 'Assalto', icon: '⚠️' },
  { label: 'Congestionamento', icon: '🚗' },
  { label: 'Via interditada', icon: '🚧' },
];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function incidentIcon(type: IncidentType) {
  return INCIDENT_TYPES.find((item) => item.label === type)?.icon ?? '⚠️';
}

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null = null;

async function getNotificationsModule(): Promise<NotificationsModule | null> {
  // O Expo Go para Android não inclui mais o suporte nativo necessário para
  // expo-notifications. O carregamento dinâmico impede que o módulo derrube o
  // aplicativo durante os testes pelo QR Code.
  if (isRunningInExpoGo()) return null;

  if (!notificationsModule) {
    notificationsModule = await import('expo-notifications');
  }
  return notificationsModule;
}

async function configureNotifications() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Alertas de trânsito',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      sound: 'default',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'sentences',
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#91A0AE"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textArea]}
      />
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cnh, setCnh] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = (nextMode: AuthMode) => {
    setMode(nextMode);
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setCnh('');
  };

  const register = async () => {
    if (!name.trim() || !email.trim() || !cnh.trim() || !password) {
      Alert.alert('Campos obrigatórios', 'Preencha todos os dados para criar a conta.');
      return;
    }
    if (!isValidEmail(email)) {
      Alert.alert('E-mail inválido', 'Informe um endereço de e-mail válido.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Senha muito curta', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Senhas diferentes', 'A confirmação deve ser igual à senha.');
      return;
    }

    setBusy(true);
    try {
      if (API_URL) {
        await request('/auth/register', 'POST', { name: name.trim(), email, password, cnh });
        reset('login'); setEmail(email.trim().toLowerCase());
        Alert.alert('Cadastro concluído', 'Agora faça o login.'); return;
      }
      const users = await loadJson<User[]>(STORAGE.users, []);
      const normalizedEmail = email.trim().toLowerCase();
      if (users.some((user) => user.email === normalizedEmail)) {
        Alert.alert('Conta já cadastrada', 'Use outro e-mail ou acesse sua conta.');
        return;
      }

      const newUser: User = {
        id: Date.now().toString(),
        name: name.trim(),
        email: normalizedEmail,
        password,
        cnh: cnh.trim(),
      };
      await AsyncStorage.setItem(STORAGE.users, JSON.stringify([...users, newUser]));
      reset('login');
      setEmail(normalizedEmail);
      Alert.alert('Cadastro concluído', 'Sua conta foi criada. Agora faça o login.');
    } catch (error) {
      Alert.alert('Não foi possível concluir', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Dados incompletos', 'Informe seu e-mail e sua senha.');
      return;
    }

    setBusy(true);
    try {
      if (API_URL) {
        const result = await request('/auth/login', 'POST', { email, password });
        await setToken(result.token);
        await AsyncStorage.setItem(STORAGE.session, JSON.stringify(result.user));
        onAuthenticated(result.user); return;
      }
      const users = await loadJson<User[]>(STORAGE.users, []);
      const user = users.find(
        (item) => item.email === email.trim().toLowerCase() && item.password === password,
      );
      if (!user) {
        Alert.alert('Acesso negado', 'E-mail ou senha incorretos.');
        return;
      }
      await AsyncStorage.setItem(STORAGE.session, JSON.stringify(user));
      onAuthenticated(user);
    } catch (error) {
      Alert.alert('Não foi possível concluir', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.authRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={styles.authHero}>
        <View style={styles.logoMark}><Text style={styles.logoEmoji}>🛡️</Text></View>
        <Text style={styles.brand}>Avisa Ai!</Text>
        <Text style={styles.authSubtitle}>Informação compartilhada para uma viagem mais segura.</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.authCard}>
        <Text style={styles.authTitle}>{mode === 'login' ? 'Acesse sua conta' : 'Cadastro do motorista'}</Text>
        <Text style={styles.authCaption}>
          {mode === 'login' ? 'Entre para consultar e reportar ocorrências.' : 'Preencha os dados para utilizar a plataforma.'}
        </Text>

        {mode === 'register' && (
          <>
            <Field label="Nome completo" value={name} onChangeText={setName} placeholder="Ex.: Fernando Silva" autoCapitalize="words" />
            <Field label="CNH" value={cnh} onChangeText={setCnh} placeholder="Número da habilitação" keyboardType="numeric" />
          </>
        )}
        <Field label="E-mail" value={email} onChangeText={setEmail} placeholder="motorista@email.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Senha" value={password} onChangeText={setPassword} placeholder="Mínimo de 6 caracteres" secureTextEntry autoCapitalize="none" />
        {mode === 'register' && (
          <Field label="Confirmar senha" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Digite a senha novamente" secureTextEntry autoCapitalize="none" />
        )}

        <PrimaryButton label={busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={mode === 'login' ? login : register} disabled={busy} />
        <Pressable onPress={() => reset(mode === 'login' ? 'register' : 'login')} style={styles.authSwitch}>
          <Text style={styles.authSwitchText}>
            {mode === 'login' ? 'Ainda não tem conta? ' : 'Já possui cadastro? '}
            <Text style={styles.authSwitchLink}>{mode === 'login' ? 'Cadastre-se' : 'Entrar'}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({ user, title }: { user: User; title: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerEyebrow}>AVISA AI!</Text>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.avatar}><Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text></View>
    </View>
  );
}

function HomeScreen({ user, onReport }: { user: User; onReport: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Header user={user} title={`Olá, ${user.name.split(' ')[0]}!`} />
      <View style={styles.safetyCard}>
        <View style={styles.safetyIcon}><Text style={styles.safetyEmoji}>🛣️</Text></View>
        <View style={styles.safetyText}>
          <Text style={styles.safetyTitle}>Boa viagem!</Text>
          <Text style={styles.safetyCaption}>Ajude outros motoristas compartilhando situações no trânsito.</Text>
        </View>
      </View>

      <Pressable onPress={onReport} style={({ pressed }) => [styles.reportCta, pressed && styles.pressed]}>
        <View style={styles.reportCtaIcon}><Text style={styles.reportCtaPlus}>＋</Text></View>
        <View style={styles.reportCtaText}>
          <Text style={styles.reportCtaTitle}>Reportar ocorrência</Text>
          <Text style={styles.reportCtaCaption}>Compartilhe atualizações sobre o trânsito</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

function IncidentCard({ incident, onPress }: { incident: Incident; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.incidentCard}>
      <View style={styles.incidentIcon}>
        <Text style={styles.incidentEmoji}>{incidentIcon(incident.type)}</Text>
      </View>
      <View style={styles.incidentBody}>
        <Text style={styles.incidentTitle}>{incident.type}</Text>
        <Text style={[styles.status, incident.status === 'Resolvida' && styles.resolved]}>{incident.status} • {incident.comments.length} comentário(s)</Text>
        <Text style={styles.incidentLocation}>📍 {incident.location}</Text>
        {!!incident.description && <Text style={styles.incidentDescription} numberOfLines={2}>{incident.description}</Text>}
        <Text style={styles.incidentTime}>{formatDate(incident.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

function ReportScreen({ user, onSaved }: { user: User; onSaved: (incident: Incident) => Promise<void> }) {
  const [type, setType] = useState<IncidentType>('Acidente');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const [coordinates, setCoordinates] = useState<Coordinates>();
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const locationRequest = useRef(0);
  const captureLocation = async () => {
    const id = ++locationRequest.current;
    setLocating(true); setLocationMessage('Buscando sua localização...');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Permissão negada. Você pode informar o local manualmente ou permitir a localização nas configurações.');
      if (!(await Location.hasServicesEnabledAsync())) throw new Error('Ative a localização do aparelho ou preencha o local manualmente.');
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Não foi possível obter o GPS a tempo. Tente novamente ou informe o local.')), 15000); }),
      ]);
      if (id !== locationRequest.current) return;
      const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
      setCoordinates(coords);
      setLocation(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`);
      setLocationMessage(`Local capturado${coords.accuracy == null ? '' : ` • precisão aproximada: ${Math.round(coords.accuracy)} m`}. Confira antes de enviar.`);
      // A captura não depende de um serviço externo de endereços.
      Location.reverseGeocodeAsync(coords).then(addresses => {
        if (id !== locationRequest.current) return;
        const a = addresses[0];
        if (a) {
          const address = [a.street, a.streetNumber, a.district, a.city || a.subregion, a.region].filter(Boolean).join(', ');
          if (address) setLocation(address);
        }
      }).catch(() => {});
    } catch (error) {
      if (id === locationRequest.current) setLocationMessage(error instanceof Error ? error.message : 'Informe a localização manualmente.');
    } finally {
      if (timeout) clearTimeout(timeout);
      if (id === locationRequest.current) setLocating(false);
    }
  };
  useEffect(() => {
    void captureLocation();
    return () => { locationRequest.current++; };
  }, []);

  const save = async () => {
    if (!location.trim()) {
      Alert.alert('Localização obrigatória', 'Informe onde a ocorrência aconteceu.');
      return;
    }
    setBusy(true);
    try {
      const incident: Incident = {
        id: Date.now().toString(),
        type,
        location: location.trim(),
        description: description.trim(),
        createdAt: new Date().toISOString(),
        reportedBy: user.id,
        status: 'Aberta', comments: [], coordinates,
      };
      await onSaved(incident);
      setType('Acidente');
      setLocation('');
      setDescription('');
      Alert.alert('Ocorrência enviada', API_URL ? 'O alerta está disponível no servidor compartilhado.' : 'O alerta foi salvo neste aparelho.');
    } catch (error) {
      Alert.alert('Não foi possível concluir', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Header user={user} title="Nova ocorrência" />
        <Text style={styles.pageIntro}>Compartilhe uma situação de risco para ajudar quem está na estrada.</Text>

        <Text style={styles.fieldLabel}>Tipo de ocorrência</Text>
        <View style={styles.typeGrid}>
          {INCIDENT_TYPES.map((item) => (
            <Pressable key={item.label} onPress={() => setType(item.label)} style={[styles.typeOption, type === item.label && styles.typeOptionActive]}>
              <Text style={styles.typeEmoji}>{item.icon}</Text>
              <Text style={[styles.typeLabel, type === item.label && styles.typeLabelActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.pageIntro}>{locationMessage}</Text>
        <PrimaryButton label={locating ? 'Obtendo localização...' : 'Usar minha localização'} onPress={captureLocation} disabled={locating || busy} />
        <Field label="Localização" value={location} onChangeText={(value) => { locationRequest.current++; setLocating(false); setCoordinates(undefined); setLocationMessage('Local informado manualmente.'); setLocation(value); }} placeholder="Ex.: Av. Paulista, próximo ao nº 1000" />
        <Field label="Descrição" value={description} onChangeText={setDescription} placeholder="Conte brevemente o que aconteceu..." multiline />

        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>{API_URL ? 'Sua localização será compartilhada junto com a ocorrência. Confira se corresponde ao local do incidente.' : 'Modo local: os dados ficam neste aparelho. A localização é capturada apenas ao registrar a ocorrência.'}</Text>
        </View>
        <PrimaryButton label={busy ? 'Enviando...' : 'Enviar alerta'} onPress={save} disabled={busy || locating} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AlertsScreen({ user, incidents, onUpdate, onRefresh, syncError }: {
  user: User; incidents: Incident[];
  onUpdate: (id: string, change: { status?: IncidentStatus; text?: string }) => Promise<void>;
  onRefresh: () => Promise<void>; syncError: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IncidentStatus | 'Todas'>('Todas');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = incidents.find(i => i.id === selectedId);
  const update = async (change: { status?: IncidentStatus; text?: string }) => {
    if (!selected || busy) return;
    setBusy(true);
    try { await onUpdate(selected.id, change); if (change.text) setText(''); }
    catch (error) { Alert.alert('Não foi possível salvar', error instanceof Error ? error.message : 'Tente novamente.'); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <Header user={user} title={selected ? 'Detalhes da ocorrência' : 'Ocorrências'} />
      {!!syncError && <Text accessibilityRole="alert" style={styles.error}>{syncError}</Text>}
      <Text style={styles.pageIntro}>{API_URL ? 'Compartilhado com outros usuários • atualização a cada 10 s' : 'Demonstração local • dados deste aparelho'}</Text>
      {selected ? <>
        <PrimaryButton label="Voltar às ocorrências" onPress={() => { setSelectedId(null); setText(''); }} disabled={busy} />
        <Text style={styles.headerTitle}>{incidentIcon(selected.type)} {selected.type}</Text>
        <Text style={styles.incidentLocation}>📍 {selected.location}</Text>
        <Text style={styles.incidentDescription}>{selected.description}</Text>
        <Text style={styles.incidentTime}>Registrada em {formatDate(selected.createdAt)}</Text>
        <Text style={[styles.status, selected.status === 'Resolvida' && styles.resolved]}>{selected.status}</Text>
        {!!selected.updatedAt && <Text style={styles.incidentTime}>Atualizada em {formatDate(selected.updatedAt)}</Text>}
        {selected.coordinates && <Text style={styles.incidentDescription}>GPS: {selected.coordinates.latitude.toFixed(6)}, {selected.coordinates.longitude.toFixed(6)}</Text>}
        {selected.reportedBy === user.id ? <View style={styles.filters}>
          {STATUSES.map(status => <Pressable key={status} disabled={busy || selected.status === status} onPress={() => {
            Alert.alert('Alterar status', `Marcar ocorrência como ${status.toLowerCase()}?`, [
              { text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => { void update({ status }); } },
            ]);
          }} style={[styles.chip, selected.status === status && styles.typeOptionActive]}><Text>{status}</Text></Pressable>)}
        </View> : <Text style={styles.incidentDescription}>Somente o autor pode alterar o status. Use os comentários para informar atualizações.</Text>}
        <Text style={styles.sectionTitle}>Comentários ({selected.comments.length})</Text>
        {selected.comments.length === 0 && <Text style={styles.incidentDescription}>Nenhum comentário. Compartilhe uma atualização sobre o local.</Text>}
        {selected.comments.map(comment => <View key={comment.id} style={styles.comment}>
          <Text style={styles.fieldLabel}>{comment.authorName}</Text>
          <Text style={styles.incidentDescription}>{comment.text}</Text>
          <Text style={styles.incidentTime}>{formatDate(comment.createdAt)}</Text>
        </View>)}
        <Field label="Sua atualização" value={text} onChangeText={v => setText(v.slice(0, 1000))} placeholder="Ex.: A via já foi liberada..." multiline />
        <Text style={styles.incidentTime}>{text.length}/1000</Text>
        <PrimaryButton label={busy ? 'Salvando...' : 'Publicar comentário'} onPress={() => { void update({ text: text.trim() }); }} disabled={busy || !text.trim()} />
      </> : <>
        <View style={styles.filters}>{(['Todas', ...STATUSES] as const).map(status =>
          <Pressable key={status} onPress={() => setFilter(status)} style={[styles.chip, filter === status && styles.typeOptionActive]}><Text>{status}</Text></Pressable>
        )}</View>
        {API_URL && <PrimaryButton label="Atualizar agora" onPress={() => { void onRefresh(); }} />}
        {incidents.filter(i => filter === 'Todas' || i.status === filter).map(incident => <IncidentCard key={incident.id} incident={incident} onPress={() => setSelectedId(incident.id)} />)}
        {!incidents.some(i => filter === 'Todas' || i.status === filter) && <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Nenhuma ocorrência neste filtro</Text></View>}
      </>}
    </ScrollView>
  );
}

function ProfileScreen({ user, incidents, onLogout }: { user: User; incidents: Incident[]; onLogout: () => void }) {
  const mine = incidents.filter((item) => item.reportedBy === user.id).length;
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Header user={user} title="Meu perfil" />
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{user.name.charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.profileName}>{user.name}</Text>
        <Text style={styles.profileEmail}>{user.email}</Text>
        <View style={styles.profileDivider} />
        <View style={styles.profileLine}><Text style={styles.profileKey}>CNH</Text><Text style={styles.profileValue}>{user.cnh}</Text></View>
        <View style={styles.profileLine}><Text style={styles.profileKey}>Ocorrências enviadas</Text><Text style={styles.profileValue}>{mine}</Text></View>
      </View>
      <Pressable onPress={onLogout} style={styles.logoutButton}>
        <Text style={styles.logoutText}>Sair da conta</Text>
      </Pressable>
      <Text style={styles.prototypeNote}>Protótipo acadêmico • Versão 2</Text>
    </ScrollView>
  );
}

function BottomNav({ active, onChange, alertCount }: { active: Tab; onChange: (tab: Tab) => void; alertCount: number }) {
  const items: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'home', label: 'Início', icon: '⌂' },
    { key: 'report', label: 'Reportar', icon: '＋' },
    { key: 'alerts', label: 'Alertas', icon: '!' },
    { key: 'profile', label: 'Perfil', icon: '●' },
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => (
        <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.navItem}>
          <View style={[styles.navIconWrap, active === item.key && styles.navIconWrapActive]}>
            <Text style={[styles.navIcon, active === item.key && styles.navIconActive]}>{item.icon}</Text>
            {item.key === 'alerts' && alertCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(alertCount, 9)}</Text></View>}
          </View>
          <Text style={[styles.navLabel, active === item.key && styles.navLabelActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [syncError, setSyncError] = useState('');
  const incidentsRef = useRef<Incident[]>([]);
  const mutationBusy = useRef(false);
  const revision = useRef(0);
  const refresh = async () => {
    if (!API_URL || mutationBusy.current) return;
    const version = revision.current;
    try {
      const items: Incident[] = await request('/incidents');
      if (version !== revision.current || mutationBusy.current) return;
      incidentsRef.current = items; setIncidents(items); setSyncError('');
    } catch { setSyncError('Não foi possível atualizar. Confira a conexão e use Atualizar agora.'); }
  };
  useEffect(() => {
    if (!user || !API_URL) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { clearInterval(timer); revision.current++; };
  }, [user]);

  useEffect(() => {
    const initialize = async () => {
      try {
        const [savedUser, savedIncidents] = await Promise.all([
          loadJson<User | null>(STORAGE.session, null),
          loadJson<Incident[]>(STORAGE.incidents, []),
        ]);
        setUser(savedUser);
        const migrated = API_URL ? [] : savedIncidents.map(i => ({ ...i, status: i.status || 'Aberta' as IncidentStatus, comments: i.comments || [] }));
        incidentsRef.current = migrated; setIncidents(migrated);
        await configureNotifications();
      } catch {
        Alert.alert('Aviso', 'Não foi possível carregar todos os dados locais.');
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, []);

  const commit = async (makeNext: (current: Incident[]) => Promise<Incident[]>) => {
    if (mutationBusy.current) throw new Error('Aguarde a operação anterior.');
    mutationBusy.current = true; revision.current++;
    try {
      const next = await makeNext(incidentsRef.current);
      if (!API_URL) await AsyncStorage.setItem(STORAGE.incidents, JSON.stringify(next));
      incidentsRef.current = next; setIncidents(next);
    } finally { mutationBusy.current = false; revision.current++; }
  };
  const updateIncident = async (id: string, change: { status?: IncidentStatus; text?: string }) => {
    if (!user) throw new Error('Faça login.');
    await commit(async current => {
      const old = current.find(i => i.id === id);
      if (!old) throw new Error('Ocorrência não encontrada.');
      if (change.status && old.reportedBy !== user.id) throw new Error('Somente o autor pode alterar o status.');
      if (change.text !== undefined && (!change.text.trim() || change.text.length > 1000)) throw new Error('Informe de 1 a 1000 caracteres.');
      const updated: Incident = API_URL
        ? await request(`/incidents/${id}/${change.status ? 'status' : 'comments'}`, 'POST', change)
        : { ...old, updatedAt: new Date().toISOString(), ...(change.status ? { status: change.status } : {}),
          comments: change.text ? [...old.comments, { id: `${Date.now()}-${Math.random()}`, authorId: user.id, authorName: user.name, text: change.text.trim(), createdAt: new Date().toISOString() }] : old.comments };
      return current.map(i => i.id === id ? updated : i);
    });
  };

  const saveIncident = async (incident: Incident) => {
    await commit(async current => {
      const saved = API_URL ? await request('/incidents', 'POST', incident) : incident;
      return [saved, ...current];
    });

    try {
      const Notifications = await getNotificationsModule();
      if (Notifications) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `${incidentIcon(incident.type)} Alerta: ${incident.type}`,
            body: incident.location,
            sound: 'default',
          },
          trigger: null,
        });
      } else {
        Alert.alert(
          `${incidentIcon(incident.type)} Alerta: ${incident.type}`,
          incident.location,
        );
      }
    } catch {
      Alert.alert(
        'Ocorrência registrada',
        'O alerta foi salvo, mas a notificação do aparelho não pôde ser exibida.',
      );
    }
    setTab('alerts');
  };

  const logout = () => {
    Alert.alert('Sair da conta', 'Deseja encerrar a sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          if (API_URL) { try { await request('/auth/logout', 'POST'); } catch {} await setToken(null); }
          await AsyncStorage.removeItem(STORAGE.session);
          revision.current++;
          if (API_URL) { incidentsRef.current = []; setIncidents([]); }
          setUser(null);
          setTab('home');
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <View style={styles.logoMark}><Text style={styles.logoEmoji}>🛡️</Text></View>
        <Text style={styles.loadingBrand}>Avisa Ai!</Text>
        <ActivityIndicator color={COLORS.white} style={styles.loader} />
      </View>
    );
  }

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return (
    <View style={styles.appRoot}>
      <StatusBar style="dark" />
      <View style={styles.flex}>
        {tab === 'home' && <HomeScreen user={user} onReport={() => setTab('report')} />}
        {tab === 'report' && <ReportScreen user={user} onSaved={saveIncident} />}
        {tab === 'alerts' && <AlertsScreen user={user} incidents={incidents} onUpdate={updateIncident} onRefresh={refresh} syncError={syncError} />}
        {tab === 'profile' && <ProfileScreen user={user} incidents={incidents} onLogout={logout} />}
      </View>
      <BottomNav active={tab} onChange={setTab} alertCount={incidents.filter(i => i.status !== 'Resolvida').length} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 16 },
  chip: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  status: { color: '#996300', fontWeight: '700', marginTop: 10 },
  resolved: { color: '#19704A' },
  error: { color: COLORS.red, marginBottom: 20 },
  sectionTitle: { color: COLORS.navy, fontSize: 20, fontWeight: '700', marginVertical: 18 },
  comment: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 12 },
  flex: { flex: 1 },
  appRoot: { flex: 1, backgroundColor: COLORS.background, paddingTop: Platform.OS === 'android' ? 24 : 44 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.navy },
  loadingBrand: { color: COLORS.white, fontWeight: '800', fontSize: 28, marginTop: 14 },
  loader: { marginTop: 28 },
  authRoot: { flex: 1, backgroundColor: COLORS.navy },
  authHero: { paddingTop: Platform.OS === 'android' ? 48 : 68, paddingHorizontal: 28, paddingBottom: 30, alignItems: 'center' },
  logoMark: { width: 62, height: 62, borderRadius: 20, backgroundColor: COLORS.cyan, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  logoEmoji: { fontSize: 31 },
  brand: { color: COLORS.white, fontSize: 30, fontWeight: '800', marginTop: 14, letterSpacing: -0.7 },
  authSubtitle: { color: '#B8CEDB', textAlign: 'center', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 320 },
  authCard: { flexGrow: 1, backgroundColor: COLORS.white, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, paddingBottom: 42 },
  authTitle: { color: COLORS.text, fontSize: 23, fontWeight: '800' },
  authCaption: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 22 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { height: 52, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, backgroundColor: '#FAFCFD', paddingHorizontal: 15, color: COLORS.text, fontSize: 15 },
  textArea: { height: 105, paddingTop: 14 },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: COLORS.blue, alignItems: 'center', justifyContent: 'center', marginTop: 7, shadowColor: COLORS.blue, shadowOpacity: 0.23, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  primaryButtonText: { color: COLORS.white, fontWeight: '800', fontSize: 16 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
  authSwitch: { paddingVertical: 20, alignItems: 'center' },
  authSwitchText: { color: COLORS.muted, fontSize: 14 },
  authSwitchLink: { color: COLORS.blue, fontWeight: '800' },
  screenContent: { paddingHorizontal: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 20 },
  headerEyebrow: { color: COLORS.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  headerTitle: { color: COLORS.navy, fontSize: 24, fontWeight: '800', marginTop: 2, letterSpacing: -0.5 },
  avatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.white, fontWeight: '800', fontSize: 18 },
  safetyCard: { backgroundColor: COLORS.navy, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  safetyIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#1B3A56', alignItems: 'center', justifyContent: 'center' },
  safetyEmoji: { fontSize: 27 },
  safetyText: { flex: 1, marginLeft: 14 },
  safetyTitle: { color: COLORS.white, fontWeight: '800', fontSize: 17 },
  safetyCaption: { color: '#BBD0DC', fontSize: 13, lineHeight: 18, marginTop: 3 },
  reportCta: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cyan, borderRadius: 18, padding: 15, marginBottom: 24 },
  reportCtaIcon: { width: 45, height: 45, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  reportCtaPlus: { color: COLORS.white, fontSize: 26, fontWeight: '500', marginTop: -2 },
  reportCtaText: { flex: 1, marginLeft: 13 },
  reportCtaTitle: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
  reportCtaCaption: { color: '#E5F8FB', fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.white, fontSize: 30, fontWeight: '300' },
  emptyCard: { backgroundColor: COLORS.white, borderRadius: 18, padding: 26, alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF3' },
  emptyEmoji: { fontSize: 31 },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  emptyCaption: { color: COLORS.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
  incidentCard: { flexDirection: 'row', backgroundColor: COLORS.white, padding: 14, borderRadius: 17, marginBottom: 11, borderWidth: 1, borderColor: '#E8EEF3' },
  incidentIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF5F8' },
  incidentEmoji: { fontSize: 23 },
  incidentBody: { flex: 1, marginLeft: 12 },
  incidentTitle: { flex: 1, color: COLORS.text, fontWeight: '800', fontSize: 15 },
  incidentLocation: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  incidentDescription: { color: '#4A5968', fontSize: 12, lineHeight: 17, marginTop: 6 },
  incidentTime: { color: '#91A0AE', fontSize: 10, marginTop: 7 },
  pageIntro: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginTop: -10, marginBottom: 22 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  typeOption: { width: '48%', minHeight: 78, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, padding: 12, justifyContent: 'center' },
  typeOptionActive: { borderColor: COLORS.blue, backgroundColor: '#EAF5F8' },
  typeEmoji: { fontSize: 22, marginBottom: 4 },
  typeLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  typeLabelActive: { color: COLORS.blue },
  infoBox: { flexDirection: 'row', backgroundColor: '#EAF5F8', borderRadius: 13, padding: 13, marginBottom: 10 },
  infoIcon: { fontSize: 15, marginRight: 9 },
  infoText: { flex: 1, color: COLORS.blue, fontSize: 12, lineHeight: 17 },
  profileCard: { backgroundColor: COLORS.white, borderRadius: 20, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF3', marginBottom: 16 },
  profileAvatar: { width: 72, height: 72, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.blue, marginBottom: 13 },
  profileAvatarText: { color: COLORS.white, fontSize: 30, fontWeight: '900' },
  profileName: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  profileEmail: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
  profileDivider: { width: '100%', height: 1, backgroundColor: COLORS.border, marginVertical: 20 },
  profileLine: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13 },
  profileKey: { color: COLORS.muted, fontSize: 13 },
  profileValue: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  logoutButton: { minHeight: 50, borderRadius: 14, backgroundColor: '#FDEEEE', alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: COLORS.red, fontWeight: '800' },
  prototypeNote: { textAlign: 'center', color: '#9AA8B5', fontSize: 11, marginTop: 20 },
  bottomNav: { minHeight: Platform.OS === 'ios' ? 84 : 68, paddingBottom: Platform.OS === 'ios' ? 18 : 6, paddingTop: 7, flexDirection: 'row', backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.border },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navIconWrap: { minWidth: 34, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navIconWrapActive: { backgroundColor: '#E7F4F7' },
  navIcon: { color: '#7D8C99', fontSize: 20, fontWeight: '700' },
  navIconActive: { color: COLORS.blue },
  navLabel: { color: '#7D8C99', fontSize: 10, fontWeight: '600', marginTop: 1 },
  navLabelActive: { color: COLORS.blue, fontWeight: '800' },
  badge: { position: 'absolute', top: -4, right: -3, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.white },
  badgeText: { color: COLORS.white, fontSize: 8, fontWeight: '900' },
});
