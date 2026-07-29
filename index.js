require('./server');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'database');
const LOG_DIR = path.join(ROOT, 'logs');

const FILES = {
  users: path.join(DB_DIR, 'users.json'),
  licenses: path.join(DB_DIR, 'licenses.json'),
  config: path.join(DB_DIR, 'config.json'),
  history: path.join(DB_DIR, 'history.json'),
  memory: path.join(DB_DIR, 'memory.json'),
  projects: path.join(DB_DIR, 'projects.json'),
  images: path.join(DB_DIR, 'images.json'),
  log: path.join(LOG_DIR, 'bot.log'),
};

const PRIMARY = 0x7c3aed;
const SECONDARY = 0x2563eb;
const SUCCESS = 0x22c55e;
const DANGER = 0xef4444;
const WARNING = 0xf59e0b;

const FREE_LIMIT = 20;
const OWNER_ID = (process.env.OWNER_ID || '').trim();

function ensureDirs() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const defaults = {
    [FILES.users]: {},
    [FILES.licenses]: {},
    [FILES.config]: {
      openai: {
        apiKey: '',
        model: process.env.OPENAI_MODEL || 'gpt-5.6',
        prompt: 'Você é uma IA amigável, inteligente, objetiva e útil. Responda em português do Brasil.',
        temperature: 0.7,
      },
      payments: {
        asaasApiKey: '',
        webhook: '',
        environment: 'sandbox',
      },
    },
    [FILES.history]: {},
    [FILES.memory]: {},
    [FILES.projects]: {},
    [FILES.images]: {},
  };

  for (const [file, value] of Object.entries(defaults)) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2));
  }

  if (!fs.existsSync(FILES.log)) fs.writeFileSync(FILES.log, '');
}

function readJSON(file, fallback) {
  try {
    ensureDirs();
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendLog(text) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(FILES.log, `[${stamp}] ${text}\n`);
}

function gen4DigitCode(existingCodes = new Set()) {
  for (let i = 0; i < 50; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!existingCodes.has(code)) return code;
  }
  return String(crypto.randomInt(1000, 10000));
}

function loadUsers() {
  return readJSON(FILES.users, {});
}

function saveUsers(users) {
  writeJSON(FILES.users, users);
}

function loadLicenses() {
  return readJSON(FILES.licenses, {});
}

function saveLicenses(licenses) {
  writeJSON(FILES.licenses, licenses);
}

function loadConfig() {
  return readJSON(FILES.config, {
    openai: {
      apiKey: '',
      model: process.env.OPENAI_MODEL || 'gpt-5.6',
      prompt: 'Você é uma IA amigável, inteligente, objetiva e útil. Responda em português do Brasil.',
      temperature: 0.7,
    },
    payments: {
      asaasApiKey: '',
      webhook: '',
      environment: 'sandbox',
    },
  });
}

function saveConfig(config) {
  writeJSON(FILES.config, config);
}

function loadProjects() {
  return readJSON(FILES.projects, {});
}

function saveProjects(projects) {
  writeJSON(FILES.projects, projects);
}

function loadImages() {
  return readJSON(FILES.images, {});
}

function saveImages(images) {
  writeJSON(FILES.images, images);
}

function loadHistoryStore() {
  return readJSON(FILES.history, {});
}

function saveHistoryStore(history) {
  writeJSON(FILES.history, history);
}

function loadMemoryStore() {
  return readJSON(FILES.memory, {});
}

function saveMemoryStore(memory) {
  writeJSON(FILES.memory, memory);
}

function isOwner(userId) {
  return OWNER_ID && userId === OWNER_ID;
}

function getAllCodes(users) {
  const set = new Set();
  for (const u of Object.values(users)) {
    if (u?.shortId) set.add(String(u.shortId));
  }
  return set;
}

function defaultUser(userId, tag = '') {
  const users = loadUsers();
  return {
    userId,
    tag,
    shortId: gen4DigitCode(getAllCodes(users)),
    createdAt: new Date().toISOString(),
    messagesUsed: 0,
    memoryEnabled: true,
    persona: 'Você é uma IA amigável, inteligente, objetiva e útil. Responda em português do Brasil.',
    memories: [],
    history: [],
    apiKey: '',
    lastSeenAt: new Date().toISOString(),
  };
}

function getUser(userId, tag = '') {
  const users = loadUsers();
  if (!users[userId]) {
    users[userId] = defaultUser(userId, tag);
    saveUsers(users);
  }

  const user = users[userId];
  if (!user.shortId) {
    const codes = getAllCodes(users);
    user.shortId = gen4DigitCode(codes);
  }
  if (!Array.isArray(user.memories)) user.memories = [];
  if (!Array.isArray(user.history)) user.history = [];
  if (typeof user.messagesUsed !== 'number') user.messagesUsed = 0;
  if (typeof user.memoryEnabled !== 'boolean') user.memoryEnabled = true;
  if (!user.persona) {
    user.persona = 'Você é uma IA amigável, inteligente, objetiva e útil. Responda em português do Brasil.';
  }
  if (!user.apiKey) user.apiKey = '';
  if (!user.createdAt) user.createdAt = new Date().toISOString();
  user.tag = tag || user.tag || '';
  user.lastSeenAt = new Date().toISOString();

  users[userId] = user;
  saveUsers(users);
  return user;
}

function findUserByShortId(shortId) {
  const users = loadUsers();
  const target = String(shortId).trim();
  for (const user of Object.values(users)) {
    if (String(user.shortId) === target) return user;
  }
  return null;
}

function updateUser(userId, patch) {
  const users = loadUsers();
  const current = users[userId] || defaultUser(userId);
  users[userId] = { ...current, ...patch, lastSeenAt: new Date().toISOString() };
  saveUsers(users);
  return users[userId];
}

function getLicense(userId) {
  const licenses = loadLicenses();
  return licenses[userId] || null;
}

function activeLicense(userId) {
  const lic = getLicense(userId);
  if (!lic) return null;
  if (!lic.expiresAt) return null;
  if (new Date(lic.expiresAt).getTime() <= Date.now()) return null;
  return lic;
}

function setLicense(userId, months, reason = 'Licença concedida pelo proprietário') {
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + Number(months));

  const licenses = loadLicenses();
  licenses[userId] = {
    plan: `${months} mês(es)`,
    months: Number(months),
    grantedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    reason,
  };
  saveLicenses(licenses);
  return licenses[userId];
}

function planName(userId) {
  const lic = activeLicense(userId);
  if (!lic) return 'Gratuito';
  return lic.plan;
}

function canUseAI(userId) {
  if (isOwner(userId)) return true;
  const user = getUser(userId);
  if (activeLicense(userId)) return true;
  return user.messagesUsed < FREE_LIMIT;
}

function addChatCount(userId) {
  if (isOwner(userId)) return;
  const user = getUser(userId);
  user.messagesUsed = (user.messagesUsed || 0) + 1;
  updateUser(userId, { messagesUsed: user.messagesUsed });
}

function historyAdd(userId, role, content) {
  const store = loadHistoryStore();
  if (!store[userId]) store[userId] = [];
  store[userId].push({ role, content, at: new Date().toISOString() });
  store[userId] = store[userId].slice(-16);
  saveHistoryStore(store);
}

function memoryAdd(userId, text) {
  const store = loadMemoryStore();
  if (!store[userId]) store[userId] = [];
  store[userId].push({ text, at: new Date().toISOString() });
  store[userId] = store[userId].slice(-30);
  saveMemoryStore(store);

  const user = getUser(userId);
  user.memories = store[userId].map((x) => x.text);
  updateUser(userId, { memories: user.memories });
}

function memoryClear(userId) {
  const store = loadMemoryStore();
  store[userId] = [];
  saveMemoryStore(store);
  updateUser(userId, { memories: [] });
}

function historyClear(userId) {
  const store = loadHistoryStore();
  store[userId] = [];
  saveHistoryStore(store);
  updateUser(userId, { history: [] });
}

function projectSave(userId, data) {
  const store = loadProjects();
  if (!store[userId]) store[userId] = [];
  store[userId].push({
    id: crypto.randomUUID(),
    ...data,
    createdAt: new Date().toISOString(),
  });
  store[userId] = store[userId].slice(-50);
  saveProjects(store);
}

function saveImageRequest(userId, prompt, result) {
  const store = loadImages();
  if (!store[userId]) store[userId] = [];
  store[userId].push({
    id: crypto.randomUUID(),
    prompt,
    result,
    createdAt: new Date().toISOString(),
  });
  store[userId] = store[userId].slice(-50);
  saveImages(store);
}

function splitText(text, size = 1900) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function formatOpenAIError(error) {
  const parts = [];
  if (error?.name) parts.push(`Nome: ${error.name}`);
  if (error?.message) parts.push(`Mensagem: ${error.message}`);
  if (error?.status) parts.push(`Status: ${error.status}`);
  if (error?.code) parts.push(`Code: ${error.code}`);
  const api = error?.error?.message || error?.response?.data?.error?.message;
  if (api) parts.push(`API: ${api}`);
  return parts.join(" | ") || String(error);
}

function buildUserPanel(userId) {
  const user = getUser(userId);
  const lic = activeLicense(userId);

  const embed = new EmbedBuilder()
    .setTitle('Monarch IA — Painel do Usuário')
    .setDescription('Gerencie seu chat, memória, perfil e recursos da sua conta.')
    .setColor(PRIMARY)
    .addFields(
      { name: 'ID interno', value: `\`${user.shortId}\``, inline: true },
      { name: 'Plano', value: lic ? lic.plan : 'Gratuito', inline: true },
      { name: 'Mensagens usadas', value: `${user.messagesUsed}/${FREE_LIMIT}`, inline: true },
      { name: 'Memória', value: user.memoryEnabled ? 'Ligada' : 'Desligada', inline: true },
      { name: 'Memórias salvas', value: `${user.memories.length}`, inline: true },
      {
        name: 'Licença',
        value: lic ? `Expira em <t:${Math.floor(new Date(lic.expiresAt).getTime() / 1000)}:R>` : 'Sem licença ativa',
        inline: true,
      },
    )
    .setFooter({ text: 'Monarch IA • Bot de IA com painel interno' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_refresh').setLabel('Atualizar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_profile').setLabel('Perfil').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_premium').setLabel('Planos').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_create_project').setLabel('Criar projeto').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_memory').setLabel('Ver memória').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_memory_add').setLabel('Adicionar memória').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_persona').setLabel('Personalidade').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_image').setLabel('Gerar imagem').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_clear').setLabel('Limpar tudo').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildProfileCard(userId, tag = '') {
  const user = getUser(userId, tag);
  const lic = activeLicense(userId);

  const embed = new EmbedBuilder()
    .setTitle(`Perfil de ${tag || 'Usuário'}`)
    .setColor(SECONDARY)
    .setDescription('Informações da sua conta dentro do Monarch IA.')
    .addFields(
      { name: 'ID interno', value: `\`${user.shortId}\``, inline: true },
      { name: 'Discord ID', value: `\`${user.userId}\``, inline: true },
      { name: 'Plano', value: lic ? lic.plan : 'Gratuito', inline: true },
      { name: 'Mensagens', value: `${user.messagesUsed}/${FREE_LIMIT}`, inline: true },
      { name: 'Memórias', value: `${user.memories.length}`, inline: true },
      { name: 'Criado em', value: `<t:${Math.floor(new Date(user.createdAt).getTime() / 1000)}:D>`, inline: true },
      {
        name: 'Licença',
        value: lic ? `Até <t:${Math.floor(new Date(lic.expiresAt).getTime() / 1000)}:R>` : 'Sem licença ativa',
        inline: false,
      },
    );

  return embed;
}

function buildOwnerPanel() {
  const users = loadUsers();
  const licenses = loadLicenses();
  const projects = loadProjects();
  const config = loadConfig();

  const totalUsers = Object.keys(users).length;
  const premiumCount = Object.values(licenses).filter((x) => x && x.expiresAt && new Date(x.expiresAt).getTime() > Date.now()).length;
  const totalProjects = Object.values(projects).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
  const usedMessages = Object.values(users).reduce((acc, u) => acc + (u?.messagesUsed || 0), 0);

  const embed = new EmbedBuilder()
    .setTitle('Monarch IA — Painel do Dono')
    .setDescription('Área exclusiva do proprietário com métricas e configurações principais.')
    .setColor(SUCCESS)
    .addFields(
      { name: 'Usuários', value: String(totalUsers), inline: true },
      { name: 'Premium ativos', value: String(premiumCount), inline: true },
      { name: 'Projetos', value: String(totalProjects), inline: true },
      { name: 'Mensagens usadas', value: String(usedMessages), inline: true },
      { name: 'OpenAI', value: config.openai?.apiKey ? 'Configurada' : 'Não configurada', inline: true },
      { name: 'Asaas', value: config.payments?.asaasApiKey ? 'Configurado' : 'Não configurado', inline: true },
    )
    .setFooter({ text: 'Monarch IA • Somente o proprietário vê este painel' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_refresh').setLabel('Atualizar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_users').setLabel('Usuários').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_licenses').setLabel('Licenças').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_logs').setLabel('Logs').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_openai').setLabel('Config. OpenAI').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_payments').setLabel('Config. Pagamentos').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_projects').setLabel('Projetos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_stats').setLabel('Estatísticas').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildProjectPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Como você quer começar?')
    .setDescription('Escolha a forma de criação. O fluxo muda de acordo com o tipo do projeto.')
    .setColor(WARNING)
    .addFields(
      { name: 'Criar tudo de uma vez', value: 'A IA entende o projeto inteiro e gera a base completa.', inline: false },
      { name: 'Parte por parte', value: 'A IA divide o projeto em etapas e vai montando aos poucos.', inline: false },
      { name: 'Fundação primeiro', value: 'A IA cria a estrutura base e depois amplia.', inline: false },
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('proj_bot').setLabel('Bot Discord').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('proj_site').setLabel('Site').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('proj_panel').setLabel('Painel Web').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('proj_api').setLabel('API').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('proj_step').setLabel('Parte por parte').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('proj_fund').setLabel('Fundação primeiro').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('proj_all').setLabel('Tudo de uma vez').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildProjectModal(kind) {
  if (kind === 'bot') {
    const modal = new ModalBuilder().setCustomId('modal_project_bot').setTitle('Criar Bot Discord');
    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Nome do bot')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Ex: Monarch Assist');
    const token = new TextInputBuilder()
      .setCustomId('token')
      .setLabel('Token do bot')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Cole o token aqui');
    const owner = new TextInputBuilder()
      .setCustomId('owner')
      .setLabel('ID do dono do Discord')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Ex: 123456789012345678');
    const idea = new TextInputBuilder()
      .setCustomId('idea')
      .setLabel('O que o bot deve fazer?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Moderação, IA, tickets, economia, música, etc.');
    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(token),
      new ActionRowBuilder().addComponents(owner),
      new ActionRowBuilder().addComponents(idea),
    );
    return modal;
  }

  if (kind === 'site') {
    const modal = new ModalBuilder().setCustomId('modal_project_site').setTitle('Criar Site');
    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Nome do projeto')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const goal = new TextInputBuilder()
      .setCustomId('goal')
      .setLabel('Objetivo do site')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Landing page, blog, loja, SaaS, etc.');
    const style = new TextInputBuilder()
      .setCustomId('style')
      .setLabel('Estilo visual')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Roxo neon, escuro, moderno...');
    const pages = new TextInputBuilder()
      .setCustomId('pages')
      .setLabel('Páginas necessárias')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('Home, Sobre, Preços, FAQ...');
    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(goal),
      new ActionRowBuilder().addComponents(style),
      new ActionRowBuilder().addComponents(pages),
    );
    return modal;
  }

  if (kind === 'panel') {
    const modal = new ModalBuilder().setCustomId('modal_project_panel').setTitle('Criar Painel Web');
    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Nome do painel')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const goal = new TextInputBuilder()
      .setCustomId('goal')
      .setLabel('O que o painel deve fazer?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Dashboard, admin, SaaS, CRM...');
    const stack = new TextInputBuilder()
      .setCustomId('stack')
      .setLabel('Stack preferida')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Next.js, React, Supabase...');
    const auth = new TextInputBuilder()
      .setCustomId('auth')
      .setLabel('Autenticação desejada')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Discord, Google, email...');
    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(goal),
      new ActionRowBuilder().addComponents(stack),
      new ActionRowBuilder().addComponents(auth),
    );
    return modal;
  }

  if (kind === 'api') {
    const modal = new ModalBuilder().setCustomId('modal_project_api').setTitle('Criar API');
    const name = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Nome da API')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const goal = new TextInputBuilder()
      .setCustomId('goal')
      .setLabel('O que a API fará?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('Pagamentos, dados, integrações...');
    const db = new TextInputBuilder()
      .setCustomId('db')
      .setLabel('Banco de dados')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('PostgreSQL, MongoDB, Supabase...');
    const auth = new TextInputBuilder()
      .setCustomId('auth')
      .setLabel('Regras e segurança')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('JWT, rate limit, permissões...');
    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(goal),
      new ActionRowBuilder().addComponents(db),
      new ActionRowBuilder().addComponents(auth),
    );
    return modal;
  }

  const modal = new ModalBuilder().setCustomId('modal_project_generic').setTitle('Projeto personalizado');
  const type = new TextInputBuilder()
    .setCustomId('type')
    .setLabel('Tipo do projeto')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Bot, site, painel, API...');
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Nome do projeto')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const details = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Descreva a ideia')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  const mode = new TextInputBuilder()
    .setCustomId('mode')
    .setLabel('Como quer começar?')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Tudo de uma vez, parte por parte...');
  modal.addComponents(
    new ActionRowBuilder().addComponents(type),
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(details),
    new ActionRowBuilder().addComponents(mode),
  );
  return modal;
}

function summarizeProjectFromMessage(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes('quero criar um bot') ||
    lower.includes('criar bot') ||
    lower.includes('novo bot') ||
    lower.includes('quero criar um site') ||
    lower.includes('criar site') ||
    lower.includes('painel web') ||
    lower.includes('dashboard') ||
    lower.includes('api') ||
    lower.includes('sistema')
  );
}

function getAIClient(apiKey) {
  return new OpenAI({ apiKey });
}

async function askAI(userId, text, options = {}) {
  const { countMessage = true, extraSystem = '' } = options;

  const user = getUser(userId);
  const config = loadConfig();
  const apiKey = (user.apiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY || '').trim();
  const model = config.openai?.model || process.env.OPENAI_MODEL || 'gpt-5.5';
  const systemPrompt = [
    config.openai?.prompt || '',
    user.persona || '',
    extraSystem || '',
  ].filter(Boolean).join('\n\n');

  if (!apiKey) {
    throw new Error('Nenhuma API da OpenAI foi configurada.');
  }

  if (countMessage && !canUseAI(userId)) {
    return {
      blocked: true,
      text: `Você atingiu o limite gratuito de ${FREE_LIMIT} mensagens. Use um plano premium ou peça ao dono para liberar sua licença.`,
    };
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  const mem = loadMemoryStore()[userId] || [];
  if (user.memoryEnabled && mem.length > 0) {
    messages.push({
      role: 'system',
      content: `Memórias do usuário:\n- ${mem.map((m) => m.text).join('\n- ')}`,
    });
  }

  const hist = loadHistoryStore()[userId] || [];
  if (user.memoryEnabled && hist.length > 0) {
    for (const item of hist.slice(-12)) {
      if (item?.role && item?.content) {
        messages.push({ role: item.role, content: item.content });
      }
    }
  }

  messages.push({ role: 'user', content: text });

  const client = getAIClient(apiKey);

  let response;

  try {
    response = await client.responses.create({
      model,
      input: messages,
      store: false,
    });
  } catch (error) {
    appendLog(`OPENAI_ERROR | model=${model} | ${formatOpenAIError(error)}`);

    // fallback automático
    if (model !== 'gpt-5.5') {
      try {
        response = await client.responses.create({
          model: 'gpt-5.5',
          input: messages,
          store: false,
        });
        appendLog('OPENAI_FALLBACK | gpt-5.6 -> gpt-5.5');
      } catch (fallbackError) {
        appendLog(`OPENAI_FALLBACK_ERROR | ${formatOpenAIError(fallbackError)}`);
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }

  let answer = '';
  if (typeof response?.output_text === 'string') {
    answer = response.output_text.trim();
  }

  if (!answer && Array.isArray(response?.output)) {
    const chunks = [];
    for (const item of response.output) {
      if (item?.content && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.text) chunks.push(c.text);
        }
      }
    }
    answer = chunks.join('\n').trim();
  }

  if (!answer) answer = 'Não consegui gerar uma resposta agora.';

  if (countMessage) {
    addChatCount(userId);
    historyAdd(userId, 'user', text);
    historyAdd(userId, 'assistant', answer);
  }

  appendLog(`AI | ${userId} | ${text.slice(0, 120).replace(/\n/g, ' ')}`);
  return { blocked: false, text: answer };
}

async function generateImage(userId, prompt) {
  const user = getUser(userId);
  const config = loadConfig();
  const apiKey = (user.apiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY || '').trim();
  const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  if (!apiKey) {
    throw new Error('Nenhuma API da OpenAI foi configurada para imagens.');
  }

  if (!canUseAI(userId)) {
    return {
      blocked: true,
      text: `Você atingiu o limite gratuito de ${FREE_LIMIT} mensagens. Use um plano premium ou peça ao dono para liberar sua licença.`,
    };
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: imageModel,
      prompt,
      size: '1024x1024',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Falha ao gerar imagem.');
  }

  addChatCount(userId);

  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const url = item?.url || '';
  const b64 = item?.b64_json || '';

  saveImageRequest(userId, prompt, {
    url: url || null,
    hasBase64: Boolean(b64),
  });

  return { url, b64 };
}

async function safeReply(interaction, payload) {
  const options = interaction.inGuild() ? { ephemeral: true } : {};
  return interaction.reply({ ...payload, ...options });
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('ia')
      .setDescription('Abre o painel da IA ou responde uma mensagem direto')
      .addStringOption((opt) =>
        opt
          .setName('prompt')
          .setDescription('Pergunte algo para a IA')
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName('painel')
      .setDescription('Abre o painel do usuário'),
    new SlashCommandBuilder()
      .setName('perfil')
      .setDescription('Mostra seu perfil'),
    new SlashCommandBuilder()
      .setName('imagem')
      .setDescription('Gera uma imagem pela IA')
      .addStringOption((opt) =>
        opt
          .setName('prompt')
          .setDescription('Descreva a imagem')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('licenca')
      .setDescription('Concede licença para um usuário')
      .addUserOption((opt) =>
        opt
          .setName('usuario')
          .setDescription('Usuário que vai receber a licença')
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('meses')
          .setDescription('Quantidade de meses')
          .addChoices(
            { name: '1 mês', value: 1 },
            { name: '3 meses', value: 3 },
            { name: '7 meses', value: 7 },
            { name: '1 ano', value: 12 },
          )
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('liberar')
      .setDescription('Concede licença pelo ID interno de 4 números')
      .addStringOption((opt) =>
        opt
          .setName('id')
          .setDescription('ID interno de 4 números')
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('meses')
          .setDescription('Quantidade de meses')
          .addChoices(
            { name: '1 mês', value: 1 },
            { name: '3 meses', value: 3 },
            { name: '7 meses', value: 7 },
            { name: '1 ano', value: 12 },
          )
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('Painel exclusivo do proprietário'),
    new SlashCommandBuilder()
      .setName('ajuda')
      .setDescription('Lista os comandos principais'),
  ].map((c) => c.toJSON());

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );
    console.log('Comandos registrados no servidor de teste.');
  } else {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Comandos registrados globalmente.');
  }
}

function buildHelpText() {
  return [
    '**Comandos principais**',
    '`/ia` → abre a IA ou conversa direta',
    '`/painel` → painel do usuário',
    '`/perfil` → seu perfil e ID interno',
    '`/imagem` → gera imagem pela IA',
    '`/licenca` → concede licença (somente dono)',
    '`/admin` → painel do dono',
    '`/ajuda` → comandos e atalhos',
    '',
    '**Atalhos de chat**',
    '• falar com a IA em DM',
    '• mencionar o bot no servidor',
    '• pedir para criar bot, site, painel ou API',
  ].join('\n');
}

function detectProjectIntent(text) {
  return summarizeProjectFromMessage(text);
}

function projectChoiceFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes('bot')) return 'bot';
  if (lower.includes('site')) return 'site';
  if (lower.includes('painel')) return 'panel';
  if (lower.includes('api')) return 'api';
  return 'generic';
}

async function sendLongReply(target, content) {
  const parts = splitText(content);
  if (!parts.length) return;

  if (target.channel && typeof target.channel.send === 'function' && target.reply) {
    await target.reply({ content: parts[0], allowedMentions: { repliedUser: false } });
    for (let i = 1; i < parts.length; i++) {
      await target.channel.send({ content: parts[i], allowedMentions: { repliedUser: false } });
    }
    return;
  }

  if (target.followUp) {
    await target.followUp({ content: parts[0], ephemeral: target.inGuild ? target.inGuild() : false });
    for (let i = 1; i < parts.length; i++) {
      await target.followUp({ content: parts[i] });
    }
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async () => {
  ensureDirs();
  console.log(`Bot online como ${client.user.tag}`);
  appendLog(`READY | ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
    appendLog(`ERROR registerCommands | ${String(error)}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const userId = interaction.user.id;
      const tag = interaction.user.tag;
      getUser(userId, tag);

      if (interaction.commandName === 'ia') {
        const prompt = interaction.options.getString('prompt');
        if (!prompt) {
          const panel = buildUserPanel(userId);
          return safeReply(interaction, panel);
        }

        const reply = await askAI(userId, prompt, { countMessage: true });
        if (reply.blocked) {
          return safeReply(interaction, {
            content: reply.text,
          });
        }

        return safeReply(interaction, {
          content: reply.text,
        });
      }

      if (interaction.commandName === 'painel') {
        return safeReply(interaction, buildUserPanel(userId));
      }

      if (interaction.commandName === 'perfil') {
        return safeReply(interaction, { embeds: [buildProfileCard(userId, tag)] });
      }

      if (interaction.commandName === 'imagem') {
        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply(interaction.inGuild() ? { ephemeral: true } : undefined);

        const result = await generateImage(userId, prompt);
        if (result.blocked) {
          return interaction.editReply({ content: result.text });
        }

        if (result.b64) {
          const buffer = Buffer.from(result.b64, 'base64');
          const attachment = new AttachmentBuilder(buffer, { name: 'monarch-image.png' });
          return interaction.editReply({
            content: `Imagem gerada para: **${prompt}**`,
            files: [attachment],
          });
        }

        if (result.url) {
          const embed = new EmbedBuilder()
            .setTitle('Imagem gerada')
            .setDescription(prompt)
            .setColor(PRIMARY)
            .setImage(result.url);
          return interaction.editReply({
            content: `Imagem gerada para: **${prompt}**`,
            embeds: [embed],
          });
        }

        return interaction.editReply({ content: 'A imagem foi gerada, mas sem link retornado pela API.' });
      }

      if (interaction.commandName === 'licenca') {
        if (!isOwner(userId)) {
          return safeReply(interaction, {
            content: 'Apenas o proprietário pode conceder licenças.',
          });
        }

        const target = interaction.options.getUser('usuario', true);
        const months = interaction.options.getInteger('meses', true);
        getUser(target.id, target.tag);

        const lic = setLicense(target.id, months, `Licença concedida manualmente por ${interaction.user.tag}`);
        appendLog(`LICENSE | ${target.id} | ${months} mês(es) | por ${interaction.user.tag}`);

        return safeReply(interaction, {
          content: `Licença concedida para **${target.tag}** por **${months} mês(es)**.\nExpira em <t:${Math.floor(new Date(lic.expiresAt).getTime() / 1000)}:R>.`,
        });
      }

      if (interaction.commandName === 'liberar') {
        if (!isOwner(userId)) {
          return safeReply(interaction, {
            content: 'Apenas o proprietário pode conceder licenças.',
          });
        }

        const internalId = interaction.options.getString('id', true).trim();
        const months = interaction.options.getInteger('meses', true);
        const targetUser = findUserByShortId(internalId);

        if (!targetUser) {
          return safeReply(interaction, {
            content: `Nenhum usuário encontrado com o ID interno \`${internalId}\`.`,
          });
        }

        const lic = setLicense(targetUser.userId, months, `Licença concedida pelo ID interno por ${interaction.user.tag}`);
        appendLog(`LICENSE_BY_ID | ${targetUser.userId} | ${internalId} | ${months} mês(es) | por ${interaction.user.tag}`);

        return safeReply(interaction, {
          content: `Licença concedida para **${targetUser.tag || targetUser.userId}** usando o ID \`${internalId}\` por **${months} mês(es)**.\nExpira em <t:${Math.floor(new Date(lic.expiresAt).getTime() / 1000)}:R>.`,
        });
      }

      if (interaction.commandName === 'admin') {
        if (!isOwner(userId)) {
          return safeReply(interaction, {
            content: 'Apenas o proprietário pode acessar este painel.',
          });
        }

        return safeReply(interaction, buildOwnerPanel());
      }

      if (interaction.commandName === 'ajuda') {
        return safeReply(interaction, { content: buildHelpText() });
      }
    }

    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const tag = interaction.user.tag;
      getUser(userId, tag);

      if (interaction.customId === 'panel_refresh') {
        return interaction.update(buildUserPanel(userId));
      }

      if (interaction.customId === 'panel_profile') {
        return safeReply(interaction, { embeds: [buildProfileCard(userId, tag)] });
      }

      if (interaction.customId === 'panel_premium') {
        const embed = new EmbedBuilder()
          .setTitle('Planos Monarch IA')
          .setColor(SUCCESS)
          .setDescription('Escolha a licença desejada.')
          .addFields(
            { name: '1 mês', value: 'R$ 5,00', inline: true },
            { name: '3 meses', value: 'R$ 12,99', inline: true },
            { name: '7 meses', value: 'R$ 21,99', inline: true },
            { name: '1 ano', value: 'R$ 35,99', inline: true },
          );
        return safeReply(interaction, { embeds: [embed] });
      }

      if (interaction.customId === 'panel_create_project') {
        return safeReply(interaction, buildProjectPanel());
      }

      if (interaction.customId === 'panel_memory') {
        const user = getUser(userId);
        const text = user.memories.length
          ? user.memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
          : 'Nenhuma memória salva ainda.';
        return safeReply(interaction, { content: `**Suas memórias:**\n${text}` });
      }

      if (interaction.customId === 'panel_memory_add') {
        const modal = new ModalBuilder()
          .setCustomId('modal_memory_add')
          .setTitle('Adicionar memória');
        const input = new TextInputBuilder()
          .setCustomId('memory_text')
          .setLabel('O que a IA deve lembrar?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Ex: responda curto, use tom profissional...');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel_persona') {
        const modal = new ModalBuilder()
          .setCustomId('modal_persona')
          .setTitle('Personalidade da IA');
        const input = new TextInputBuilder()
          .setCustomId('persona_text')
          .setLabel('Como a IA deve responder?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Ex: amigável, rápida, técnica e objetiva...');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel_image') {
        const modal = new ModalBuilder()
          .setCustomId('modal_image')
          .setTitle('Gerar imagem');
        const prompt = new TextInputBuilder()
          .setCustomId('prompt')
          .setLabel('Descreva a imagem')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Ex: logo neon roxa e azul para Monarch IA');
        const style = new TextInputBuilder()
          .setCustomId('style')
          .setLabel('Estilo')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Ex: neon, futurista, dark...');
        modal.addComponents(
          new ActionRowBuilder().addComponents(prompt),
          new ActionRowBuilder().addComponents(style),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel_clear') {
        historyClear(userId);
        memoryClear(userId);
        updateUser(userId, { messagesUsed: 0 });
        return safeReply(interaction, { content: 'Memória, histórico e contador limpos.' });
      }

      if (interaction.customId === 'proj_bot') {
        return interaction.showModal(buildProjectModal('bot'));
      }

      if (interaction.customId === 'proj_site') {
        return interaction.showModal(buildProjectModal('site'));
      }

      if (interaction.customId === 'proj_panel') {
        return interaction.showModal(buildProjectModal('panel'));
      }

      if (interaction.customId === 'proj_api') {
        return interaction.showModal(buildProjectModal('api'));
      }

      if (interaction.customId === 'proj_all' || interaction.customId === 'proj_step' || interaction.customId === 'proj_fund') {
        return interaction.showModal(buildProjectModal('generic'));
      }

      if (interaction.customId === 'admin_refresh') {
        if (!isOwner(userId)) {
          return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        }
        return interaction.update(buildOwnerPanel());
      }

      if (interaction.customId === 'admin_users') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        const users = loadUsers();
        const latest = Object.values(users)
          .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))
          .slice(0, 10)
          .map((u) => `• \`${u.shortId}\` — <@${u.userId}> — mensagens: ${u.messagesUsed || 0}`)
          .join('\n') || 'Sem usuários ainda.';
        return safeReply(interaction, { content: `**Últimos usuários:**\n${latest}` });
      }

      if (interaction.customId === 'admin_licenses') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        const licenses = loadLicenses();
        const list = Object.entries(licenses)
          .map(([uid, lic]) => `• <@${uid}> — ${lic.plan} — expira <t:${Math.floor(new Date(lic.expiresAt).getTime() / 1000)}:R>`)
          .join('\n') || 'Nenhuma licença ativa.';
        return safeReply(interaction, { content: `**Licenças ativas:**\n${list}` });
      }

      if (interaction.customId === 'admin_logs') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        const raw = fs.existsSync(FILES.log) ? fs.readFileSync(FILES.log, 'utf8').trim() : '';
        const lines = raw ? raw.split('\n').slice(-15).join('\n') : 'Sem logs ainda.';
        return safeReply(interaction, { content: `**Logs recentes:**\n\`\`\`\n${lines}\n\`\`\`` });
      }

      if (interaction.customId === 'admin_stats') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        const users = loadUsers();
        const licenses = loadLicenses();
        const projects = loadProjects();
        const config = loadConfig();
        const totalUsers = Object.keys(users).length;
        const premiumCount = Object.values(licenses).filter((x) => x && x.expiresAt && new Date(x.expiresAt).getTime() > Date.now()).length;
        const totalProjects = Object.values(projects).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
        const usedMessages = Object.values(users).reduce((acc, u) => acc + (u?.messagesUsed || 0), 0);

        const embed = new EmbedBuilder()
          .setTitle('Estatísticas da Monarch IA')
          .setColor(PRIMARY)
          .addFields(
            { name: 'Usuários', value: String(totalUsers), inline: true },
            { name: 'Premium ativos', value: String(premiumCount), inline: true },
            { name: 'Projetos', value: String(totalProjects), inline: true },
            { name: 'Mensagens usadas', value: String(usedMessages), inline: true },
            { name: 'OpenAI', value: config.openai?.apiKey ? 'Configurada' : 'Não configurada', inline: true },
            { name: 'Asaas', value: config.payments?.asaasApiKey ? 'Configurado' : 'Não configurado', inline: true },
          );
        return safeReply(interaction, { embeds: [embed] });
      }

      if (interaction.customId === 'admin_openai') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });

        const modal = new ModalBuilder()
          .setCustomId('modal_admin_openai')
          .setTitle('Configurar OpenAI');

        const key = new TextInputBuilder()
          .setCustomId('apiKey')
          .setLabel('API Key')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('sk-...');
        const model = new TextInputBuilder()
          .setCustomId('model')
          .setLabel('Modelo')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('gpt-5.5');
        const prompt = new TextInputBuilder()
          .setCustomId('prompt')
          .setLabel('Prompt do sistema')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Instruções principais da IA...');
        const temp = new TextInputBuilder()
          .setCustomId('temperature')
          .setLabel('Temperatura')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('0.7');

        modal.addComponents(
          new ActionRowBuilder().addComponents(key),
          new ActionRowBuilder().addComponents(model),
          new ActionRowBuilder().addComponents(prompt),
          new ActionRowBuilder().addComponents(temp),
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === 'admin_payments') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });

        const modal = new ModalBuilder()
          .setCustomId('modal_admin_payments')
          .setTitle('Configurar pagamentos');

        const apiKey = new TextInputBuilder()
          .setCustomId('asaasApiKey')
          .setLabel('Asaas API Key')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Cole a chave da sua conta Asaas');
        const webhook = new TextInputBuilder()
          .setCustomId('webhook')
          .setLabel('Webhook')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://...');
        const env = new TextInputBuilder()
          .setCustomId('environment')
          .setLabel('Ambiente')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('sandbox ou production');

        modal.addComponents(
          new ActionRowBuilder().addComponents(apiKey),
          new ActionRowBuilder().addComponents(webhook),
          new ActionRowBuilder().addComponents(env),
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === 'admin_projects') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });
        const projects = loadProjects();
        const list = Object.entries(projects)
          .map(([uid, items]) => `• <@${uid}> — ${Array.isArray(items) ? items.length : 0} projeto(s)`)
          .join('\n') || 'Nenhum projeto salvo.';
        return safeReply(interaction, { content: `**Projetos salvos:**\n${list}` });
      }
    }

    if (interaction.isModalSubmit()) {
      const userId = interaction.user.id;
      const tag = interaction.user.tag;
      getUser(userId, tag);

      if (interaction.customId === 'modal_memory_add') {
        const text = interaction.fields.getTextInputValue('memory_text').trim();
        if (!text) return safeReply(interaction, { content: 'A memória não pode ficar vazia.' });
        memoryAdd(userId, text);
        return safeReply(interaction, { content: 'Memória salva com sucesso.' });
      }

      if (interaction.customId === 'modal_persona') {
        const text = interaction.fields.getTextInputValue('persona_text').trim();
        if (!text) return safeReply(interaction, { content: 'A personalidade não pode ficar vazia.' });
        updateUser(userId, { persona: text });
        return safeReply(interaction, { content: 'Personalidade atualizada.' });
      }

      if (interaction.customId === 'modal_image') {
        const prompt = interaction.fields.getTextInputValue('prompt').trim();
        const style = interaction.fields.getTextInputValue('style').trim();
        const finalPrompt = style ? `${prompt}. Estilo: ${style}` : prompt;

        await interaction.deferReply(interaction.inGuild() ? { ephemeral: true } : undefined);
        try {
          const result = await generateImage(userId, finalPrompt);
          if (result.blocked) {
            return interaction.editReply({ content: result.text });
          }

          if (result.b64) {
            const buffer = Buffer.from(result.b64, 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: 'monarch-image.png' });
            return interaction.editReply({
              content: `Imagem gerada para: **${finalPrompt}**`,
              files: [attachment],
            });
          }

          if (result.url) {
            const embed = new EmbedBuilder()
              .setTitle('Imagem gerada')
              .setColor(PRIMARY)
              .setDescription(finalPrompt)
              .setImage(result.url);
            return interaction.editReply({
              content: `Imagem gerada para: **${finalPrompt}**`,
              embeds: [embed],
            });
          }

          return interaction.editReply({ content: 'Imagem gerada, mas sem link retornado.' });
        } catch (error) {
          appendLog(`IMAGE_ERROR | ${userId} | ${String(error)}`);
          return interaction.editReply({ content: `Erro ao gerar imagem: ${String(error).slice(0, 500)}` });
        }
      }

      if (interaction.customId === 'modal_admin_openai') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });

        const apiKey = interaction.fields.getTextInputValue('apiKey').trim();
        const model = interaction.fields.getTextInputValue('model').trim();
        const prompt = interaction.fields.getTextInputValue('prompt').trim();
        const temperature = Number(interaction.fields.getTextInputValue('temperature').trim().replace(',', '.')) || 0.7;

        const config = loadConfig();
        config.openai = {
          apiKey,
          model,
          prompt,
          temperature,
        };
        saveConfig(config);
        appendLog(`CONFIG | OpenAI atualizado por ${tag}`);
        return safeReply(interaction, { content: 'Configuração da OpenAI salva com sucesso.' });
      }

      if (interaction.customId === 'modal_admin_payments') {
        if (!isOwner(userId)) return safeReply(interaction, { content: 'Apenas o proprietário pode usar isso.' });

        const asaasApiKey = interaction.fields.getTextInputValue('asaasApiKey').trim();
        const webhook = interaction.fields.getTextInputValue('webhook').trim();
        const environment = interaction.fields.getTextInputValue('environment').trim();

        const config = loadConfig();
        config.payments = {
          asaasApiKey,
          webhook,
          environment,
        };
        saveConfig(config);
        appendLog(`CONFIG | Pagamentos atualizados por ${tag}`);
        return safeReply(interaction, { content: 'Configuração de pagamentos salva com sucesso.' });
      }

      if (interaction.customId === 'modal_project_bot') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const token = interaction.fields.getTextInputValue('token').trim();
        const owner = interaction.fields.getTextInputValue('owner').trim();
        const idea = interaction.fields.getTextInputValue('idea').trim();

        projectSave(userId, {
          type: 'bot',
          name,
          tokenPreview: token.slice(0, 8),
          owner,
          idea,
          mode: 'bot',
        });

        const summary = await askAI(
          userId,
          `Projeto de BOT do Discord recebido.\nNome: ${name}\nID do dono: ${owner}\nIdeia: ${idea}\n\nCrie um resumo curto do projeto e diga qual o melhor próximo passo: fundação primeiro, parte por parte ou tudo de uma vez.`,
          { countMessage: false }
        );

        if (summary.blocked) return safeReply(interaction, { content: summary.text });

        return safeReply(interaction, { content: summary.text });
      }

      if (interaction.customId === 'modal_project_site') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const goal = interaction.fields.getTextInputValue('goal').trim();
        const style = interaction.fields.getTextInputValue('style').trim();
        const pages = interaction.fields.getTextInputValue('pages').trim();

        projectSave(userId, {
          type: 'site',
          name,
          goal,
          style,
          pages,
          mode: 'site',
        });

        const summary = await askAI(
          userId,
          `Projeto de SITE recebido.\nNome: ${name}\nObjetivo: ${goal}\nEstilo: ${style || 'não informado'}\nPáginas: ${pages || 'não informado'}\n\nCrie um resumo curto do projeto e diga qual o melhor próximo passo: fundação primeiro, parte por parte ou tudo de uma vez.`,
          { countMessage: false }
        );

        if (summary.blocked) return safeReply(interaction, { content: summary.text });
        return safeReply(interaction, { content: summary.text });
      }

      if (interaction.customId === 'modal_project_panel') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const goal = interaction.fields.getTextInputValue('goal').trim();
        const stack = interaction.fields.getTextInputValue('stack').trim();
        const auth = interaction.fields.getTextInputValue('auth').trim();

        projectSave(userId, {
          type: 'panel',
          name,
          goal,
          stack,
          auth,
          mode: 'panel',
        });

        const summary = await askAI(
          userId,
          `Projeto de PAINEL WEB recebido.\nNome: ${name}\nObjetivo: ${goal}\nStack: ${stack || 'não informado'}\nAuth: ${auth || 'não informado'}\n\nCrie um resumo curto do projeto e diga qual o melhor próximo passo: fundação primeiro, parte por parte ou tudo de uma vez.`,
          { countMessage: false }
        );

        if (summary.blocked) return safeReply(interaction, { content: summary.text });
        return safeReply(interaction, { content: summary.text });
      }

      if (interaction.customId === 'modal_project_api') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const goal = interaction.fields.getTextInputValue('goal').trim();
        const db = interaction.fields.getTextInputValue('db').trim();
        const auth = interaction.fields.getTextInputValue('auth').trim();

        projectSave(userId, {
          type: 'api',
          name,
          goal,
          db,
          auth,
          mode: 'api',
        });

        const summary = await askAI(
          userId,
          `Projeto de API recebido.\nNome: ${name}\nObjetivo: ${goal}\nBanco: ${db || 'não informado'}\nSegurança: ${auth || 'não informado'}\n\nCrie um resumo curto do projeto e diga qual o melhor próximo passo: fundação primeiro, parte por parte ou tudo de uma vez.`,
          { countMessage: false }
        );

        if (summary.blocked) return safeReply(interaction, { content: summary.text });
        return safeReply(interaction, { content: summary.text });
      }

      if (interaction.customId === 'modal_project_generic') {
        const type = interaction.fields.getTextInputValue('type').trim();
        const name = interaction.fields.getTextInputValue('name').trim();
        const details = interaction.fields.getTextInputValue('details').trim();
        const mode = interaction.fields.getTextInputValue('mode').trim();

        projectSave(userId, {
          type,
          name,
          details,
          mode: mode || 'não informado',
        });

        const summary = await askAI(
          userId,
          `Projeto personalizado recebido.\nTipo: ${type}\nNome: ${name}\nDetalhes: ${details}\nModo desejado: ${mode || 'não informado'}\n\nCrie um resumo curto do projeto e diga qual o melhor próximo passo: fundação primeiro, parte por parte ou tudo de uma vez.`,
          { countMessage: false }
        );

        if (summary.blocked) return safeReply(interaction, { content: summary.text });
        return safeReply(interaction, { content: summary.text });
      }
    }
  } catch (error) {
    console.error('Erro na interação:', error);
    appendLog(`INTERACTION_ERROR | ${String(error)}`);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Deu erro nessa ação.', ephemeral: true });
      } catch {}
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const content = (message.content || '').trim();
    if (!content) return;

    const isDM = message.channel.isDMBased();
    const mentioned = message.mentions.has(client.user);

    if (!isDM && !mentioned && !content.startsWith('/')) return;

    getUser(message.author.id, message.author.tag);

    if (content.toLowerCase() === '/painel') {
      const panel = buildUserPanel(message.author.id);
      await message.reply({ ...panel, allowedMentions: { repliedUser: false } });
      return;
    }

    if (content.toLowerCase() === '/perfil') {
      await message.reply({
        embeds: [buildProfileCard(message.author.id, message.author.tag)],
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    if (content.toLowerCase() === '/ajuda') {
      await message.reply({ content: buildHelpText(), allowedMentions: { repliedUser: false } });
      return;
    }

    if (content.toLowerCase() === '/esquecer') {
      memoryClear(message.author.id);
      historyClear(message.author.id);
      updateUser(message.author.id, { messagesUsed: 0 });
      await message.reply({ content: 'Histórico e memória apagados.', allowedMentions: { repliedUser: false } });
      return;
    }

    if (content.toLowerCase() === '/memoria') {
      const user = getUser(message.author.id);
      const text = user.memories.length
        ? user.memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
        : 'Nenhuma memória salva ainda.';
      await message.reply({ content: `**Memórias:**\n${text}`, allowedMentions: { repliedUser: false } });
      return;
    }

    if (content.toLowerCase().startsWith('/lembrar ')) {
      const note = content.slice(9).trim();
      if (!note) {
        await message.reply({ content: 'Escreva algo depois de /lembrar.', allowedMentions: { repliedUser: false } });
        return;
      }
      memoryAdd(message.author.id, note);
      await message.reply({ content: 'Memória salva.', allowedMentions: { repliedUser: false } });
      return;
    }

    if (content.toLowerCase() === '/ia') {
      const panel = buildUserPanel(message.author.id);
      await message.reply({ ...panel, allowedMentions: { repliedUser: false } });
      return;
    }

    if (detectProjectIntent(content)) {
      const summary = await askAI(
        message.author.id,
        `O usuário disse: "${content}". Responda de forma curta, natural e específica. Não use texto genérico. Diga que entendeu o tipo de projeto e convide o usuário a escolher a forma de começar.`,
        { countMessage: false }
      );

      await message.reply({
        content: summary.blocked ? 'Escolha como quer começar o projeto.' : summary.text,
        components: buildProjectPanel().components,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    if (!canUseAI(message.author.id)) {
      await message.reply({
        content: `Você atingiu o limite gratuito de ${FREE_LIMIT} mensagens. Use uma licença premium ou peça ao dono para liberar sua conta.`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    await message.channel.sendTyping();

    const response = await askAI(message.author.id, content, { countMessage: true });
    if (response.blocked) {
      await message.reply({
        content: response.text,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    const parts = splitText(response.text);
    if (parts.length === 1) {
      await message.reply({
        content: parts[0],
        allowedMentions: { repliedUser: false },
      });
    } else {
      await message.reply({
        content: parts[0],
        allowedMentions: { repliedUser: false },
      });
      for (let i = 1; i < parts.length; i++) {
        await message.channel.send({
          content: parts[i],
          allowedMentions: { repliedUser: false },
        });
      }
    }
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    appendLog(`MESSAGE_ERROR | ${String(error)}`);
    try {
      await message.reply('Não consegui responder agora. Verifique a chave, o modelo e os logs do Render.');
    } catch {}
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  appendLog(`UNHANDLED_REJECTION | ${String(error)}`);
});

const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const CLIENT_ID = (process.env.CLIENT_ID || '').trim();

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.log('Preencha DISCORD_TOKEN e CLIENT_ID no .env');
  process.exit(1);
}

ensureDirs();

client.login(DISCORD_TOKEN);
