require('./server');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk');
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
      ia: {
        apiKey: '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
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
    ia: {
      apiKey: '',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
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
    lastSeenAt: new Date().toISOString(),

    messagesUsed: 0,

    memoryEnabled: true,

    persona:
      'Você é uma IA extremamente inteligente, rápida, educada e responde sempre em português.',

    memories: [],
    history: [],

    apiKey: '',
  };
}

function getUser(userId, tag = '') {
  const users = loadUsers();

  if (!users[userId]) {
    users[userId] = defaultUser(userId, tag);
    saveUsers(users);
  }

  const user = users[userId];

  user.tag = tag || user.tag || '';
  user.lastSeenAt = new Date().toISOString();

  if (!Array.isArray(user.memories)) user.memories = [];
  if (!Array.isArray(user.history)) user.history = [];

  users[userId] = user;
  saveUsers(users);

  return user;
}

function updateUser(userId, patch) {
  const users = loadUsers();

  users[userId] = {
    ...getUser(userId),
    ...patch,
    lastSeenAt: new Date().toISOString(),
  };

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

  if (new Date(lic.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return lic;
}

function setLicense(userId, months, reason = '') {
  const licenses = loadLicenses();

  const now = new Date();

  const expires = new Date();

  expires.setMonth(expires.getMonth() + Number(months));

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

function canUseAI(userId) {

  if (isOwner(userId)) return true;

  if (activeLicense(userId)) return true;

  const user = getUser(userId);

  return user.messagesUsed < FREE_LIMIT;
}

function addChatCount(userId) {

  if (isOwner(userId)) return;

  const user = getUser(userId);

  updateUser(userId, {
    messagesUsed: (user.messagesUsed || 0) + 1,
  });
}

function historyAdd(userId, role, content) {

  const store = loadHistoryStore();

  if (!store[userId]) store[userId] = [];

  store[userId].push({
    role,
    content,
    at: new Date().toISOString(),
  });

  store[userId] = store[userId].slice(-20);

  saveHistoryStore(store);

  updateUser(userId, {
    history: store[userId],
  });
}

function historyClear(userId) {

  const store = loadHistoryStore();

  store[userId] = [];

  saveHistoryStore(store);

  updateUser(userId, {
    history: [],
  });
}

function memoryAdd(userId, text) {

  const store = loadMemoryStore();

  if (!store[userId]) store[userId] = [];

  store[userId].push({
    text,
    at: new Date().toISOString(),
  });

  store[userId] = store[userId].slice(-30);

  saveMemoryStore(store);

  updateUser(userId, {
    memories: store[userId].map(x => x.text),
  });
}

function memoryClear(userId) {

  const store = loadMemoryStore();

  store[userId] = [];

  saveMemoryStore(store);

  updateUser(userId, {
    memories: [],
  });
}


function buildUserPanel(userId) {

  const user = getUser(userId);

  const lic = activeLicense(userId);

  const embed = new EmbedBuilder()

    .setColor(PRIMARY)

    .setTitle("🧠 MONARCH IA")

    .setDescription(
`Bem-vindo ao painel da sua IA.

**Plano:** ${lic ? lic.plan : "Gratuito"}
**Mensagens:** ${user.messagesUsed}/${FREE_LIMIT}
**Memória:** ${user.memoryEnabled ? "Ligada" : "Desligada"}
**Memórias:** ${user.memories.length}
**ID Interno:** ${user.shortId}`
)

.setFooter({
text:"MONARCH IA • Painel Inteligente"
});

const row1=new ActionRowBuilder()

.addComponents(

new ButtonBuilder()

.setCustomId("panel_chat")

.setLabel("Conversar")

.setEmoji("💬")

.setStyle(ButtonStyle.Primary),

new ButtonBuilder()

.setCustomId("panel_memory")

.setLabel("Memória")

.setEmoji("🧠")

.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()

.setCustomId("panel_profile")

.setLabel("Perfil")

.setEmoji("👤")

.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()

.setCustomId("panel_projects")

.setLabel("Projetos")

.setEmoji("📁")

.setStyle(ButtonStyle.Success)

);

const row2=new ActionRowBuilder()

.addComponents(

new ButtonBuilder()

.setCustomId("panel_image")

.setLabel("Imagem")

.setEmoji("🖼")

.setStyle(ButtonStyle.Primary),

new ButtonBuilder()

.setCustomId("panel_persona")

.setLabel("Personalidade")

.setEmoji("🤖")

.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()

.setCustomId("panel_clear")

.setLabel("Limpar")

.setEmoji("🗑")

.setStyle(ButtonStyle.Danger),

new ButtonBuilder()

.setCustomId("panel_refresh")

.setLabel("Atualizar")

.setEmoji("🔄")

.setStyle(ButtonStyle.Success)

);

return {

embeds:[embed],

components:[row1,row2]

};

}

function buildOwnerPanel(){

const users=loadUsers();

const licenses=loadLicenses();

const projects=loadProjects();

const config=loadConfig();

const embed=new EmbedBuilder()

.setColor(SUCCESS)

.setTitle("👑 Painel do Proprietário")

.addFields(

{name:"Usuários",value:String(Object.keys(users).length),inline:true},

{name:"Premium",value:String(Object.keys(licenses).length),inline:true},

{name:"Projetos",value:String(Object.keys(projects).length),inline:true},

{name:"Modelo IA",value:config.ia.model,inline:true}

)

.setFooter({

text:"MONARCH IA ADMIN"

});

const row=new ActionRowBuilder()

.addComponents(

new ButtonBuilder()

.setCustomId("admin_users")

.setLabel("Usuários")

.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()

.setCustomId("admin_config")

.setLabel("IA")

.setStyle(ButtonStyle.Primary),

new ButtonBuilder()

.setCustomId("admin_payments")

.setLabel("Pagamentos")

.setStyle(ButtonStyle.Success),

new ButtonBuilder()

.setCustomId("admin_logs")

.setLabel("Logs")

.setStyle(ButtonStyle.Danger)

);

return{

embeds:[embed],

components:[row]

};

}


function getAIClient(apiKey) {
  return new Groq({
    apiKey,
  });
}

async function askAI(userId, text, options = {}) {

  const { countMessage = true, extraSystem = '' } = options;

  const user = getUser(userId);
  const config = loadConfig();

  const apiKey =
    (
      user.apiKey ||
      config.ia?.apiKey ||
      process.env.GROQ_API_KEY
    ).trim();

  const model =
    config.ia?.model ||
    process.env.GROQ_MODEL ||
    "llama-3.3-70b-versatile";

  if (!apiKey) {
    throw new Error("Nenhuma API da Groq foi configurada.");
  }

  if (countMessage && !canUseAI(userId)) {
    return {
      blocked: true,
      text: `Você atingiu o limite gratuito de ${FREE_LIMIT} mensagens.`,
    };
  }

  const messages = [];

  messages.push({
    role: "system",
    content:
      [
        config.ia?.prompt || "",
        user.persona || "",
        extraSystem || "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  });

  const mem = loadMemoryStore()[userId] || [];

  if (user.memoryEnabled && mem.length) {
    messages.push({
      role: "system",
      content:
        "Memórias do usuário:\n- " +
        mem.map(x => x.text).join("\n- "),
    });
  }

  const hist = loadHistoryStore()[userId] || [];

  for (const h of hist.slice(-12)) {
    messages.push({
      role: h.role,
      content: h.content,
    });
  }

  messages.push({
    role: "user",
    content: text,
  });

  const client = getAIClient(apiKey);

  const completion =
    await client.chat.completions.create({

      model,

      temperature:
        config.ia?.temperature ?? 0.7,

      messages,

    });

  const answer =
    completion.choices?.[0]?.message?.content ||
    "Não consegui responder agora.";

  if (countMessage) {

    addChatCount(userId);

    historyAdd(userId, "user", text);

    historyAdd(userId, "assistant", answer);

  }

  appendLog(
    `GROQ | ${userId} | ${model}`
  );

  return {

    blocked: false,

    text: answer,

  };

}


async function generateImage(userId, prompt) {

  if (!canUseAI(userId)) {
    return {
      blocked: true,
      text: `Você atingiu o limite gratuito de ${FREE_LIMIT} mensagens.`,
    };
  }

  const images = loadImages();

  if (!images[userId]) {
    images[userId] = [];
  }

  const image = {
    id: crypto.randomUUID(),
    prompt,
    provider: "groq",
    status: "pendente",
    createdAt: new Date().toISOString(),
  };

  images[userId].push(image);

  saveImages(images);

  addChatCount(userId);

  appendLog(`IMAGE | ${userId} | ${prompt}`);

  return {
    blocked: false,
    text:
      "A geração de imagens ainda não está configurada. Integre um provedor compatível e esta função continuará funcionando sem alterar o restante do sistema.",
  };

}

function saveImageRequest(userId, prompt, result) {

  const store = loadImages();

  if (!store[userId]) {
    store[userId] = [];
  }

  store[userId].push({
    id: crypto.randomUUID(),
    prompt,
    result,
    createdAt: new Date().toISOString(),
  });

  store[userId] = store[userId].slice(-50);

  saveImages(store);

}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,
  ],
});

const commands = [

  new SlashCommandBuilder()
    .setName("ia")
    .setDescription("Conversar com a Monarch IA")
    .addStringOption(o =>
      o
        .setName("mensagem")
        .setDescription("Mensagem para a IA")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Abrir painel"),

  new SlashCommandBuilder()
    .setName("perfil")
    .setDescription("Mostrar perfil"),

  new SlashCommandBuilder()
    .setName("imagem")
    .setDescription("Gerar imagem")
    .addStringOption(o =>
      o
        .setName("prompt")
        .setDescription("Descrição da imagem")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("liberar")
    .setDescription("Dar licença")
    .addUserOption(o =>
      o
        .setName("usuario")
        .setDescription("Usuário")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o
        .setName("meses")
        .setDescription("Meses")
        .setRequired(true)
    ),

].map(c => c.toJSON());

async function registerCommands() {

  if (!process.env.CLIENT_ID) return;

  if (!process.env.GUILD_ID) return;

  const rest = new REST({
    version: "10",
  }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(

    Routes.applicationGuildCommands(

      process.env.CLIENT_ID,

      process.env.GUILD_ID

    ),

    {
      body: commands,
    }

  );

  console.log("Slash Commands registrados.");

}

client.once(Events.ClientReady, async bot => {

  console.log(`MONARCH ONLINE como ${bot.user.tag}`);

  try {

    await registerCommands();

  } catch (e) {

    console.error(e);

  }

});


client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const tag = interaction.user.tag;

  getUser(userId, tag);

  /* ===========================
     /painel
  =========================== */

  if (interaction.commandName === "painel") {

    return interaction.reply({
      ...buildUserPanel(userId),
      ephemeral: true,
    });

  }

  /* ===========================
     /perfil
  =========================== */

  if (interaction.commandName === "perfil") {

    const user = getUser(userId);

    const lic = activeLicense(userId);

    const embed = new EmbedBuilder()

      .setColor(PRIMARY)

      .setTitle("👤 Seu Perfil")

      .addFields(

        {
          name: "Plano",
          value: lic ? lic.plan : "Gratuito",
          inline: true,
        },

        {
          name: "Mensagens",
          value: `${user.messagesUsed}/${FREE_LIMIT}`,
          inline: true,
        },

        {
          name: "Memórias",
          value: String(user.memories.length),
          inline: true,
        },

        {
          name: "ID Interno",
          value: user.shortId,
          inline: true,
        }

      );

    return interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });

  }

  /* ===========================
     /ia
  =========================== */

  if (interaction.commandName === "ia") {

    const pergunta =
      interaction.options.getString("mensagem", true);

    await interaction.deferReply();

    try {

      const resposta =
        await askAI(userId, pergunta);

      if (resposta.blocked) {

        return interaction.editReply({
          content: resposta.text,
        });

      }

      const partes = splitText(resposta.text);

      await interaction.editReply({
        content: partes.shift(),
      });

      for (const parte of partes) {

        await interaction.followUp({
          content: parte,
        });

      }

    } catch (err) {

      console.error(err);

      interaction.editReply({

        content:
          "❌ Ocorreu um erro ao consultar a IA.",

      });

    }

  }

});


client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  /* ===========================
     /imagem
  =========================== */

  if (interaction.commandName === "imagem") {

    const prompt =
      interaction.options.getString("prompt", true);

    await interaction.deferReply({
      ephemeral: true,
    });

    try {

      const result =
        await generateImage(userId, prompt);

      return interaction.editReply({
        content: result.text,
      });

    } catch (err) {

      console.error(err);

      return interaction.editReply({
        content:
          "❌ Erro ao gerar imagem.",
      });

    }

  }

  /* ===========================
     /liberar
  =========================== */

  if (interaction.commandName === "liberar") {

    if (!isOwner(userId)) {

      return interaction.reply({

        content:
          "❌ Apenas o proprietário pode usar este comando.",

        ephemeral: true,

      });

    }

    const alvo =
      interaction.options.getUser("usuario", true);

    const meses =
      interaction.options.getInteger("meses", true);

    const lic =
      setLicense(

        alvo.id,

        meses,

        `Concedida por ${interaction.user.tag}`

      );

    appendLog(

      `LICENSE | ${interaction.user.id} -> ${alvo.id} (${meses} meses)`

    );

    return interaction.reply({

      embeds: [

        new EmbedBuilder()

          .setColor(SUCCESS)

          .setTitle("✅ Licença concedida")

          .addFields(

            {

              name: "Usuário",

              value: `<@${alvo.id}>`,

              inline: true,

            },

            {

              name: "Plano",

              value: lic.plan,

              inline: true,

            },

            {

              name: "Expira",

              value: `<t:${Math.floor(new Date(lic.expiresAt).getTime()/1000)}:F>`,

            }

          ),

      ],

      ephemeral: true,

    });

  }

});


client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const tag = interaction.user.tag;

  getUser(userId, tag);

  switch (interaction.customId) {

    case "panel_refresh":
      return interaction.update(buildUserPanel(userId));

    case "panel_profile": {

      const embed = buildProfileCard(userId, tag);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

    }

    case "panel_memory": {

      const mem = loadMemoryStore()[userId] || [];

      const embed = new EmbedBuilder()
        .setColor(PRIMARY)
        .setTitle("🧠 Memórias")

        .setDescription(

          mem.length
            ? mem.map((m, i) => `${i + 1}. ${m.text}`).join("\n")
            : "Nenhuma memória salva."

        );

      return interaction.reply({

        embeds: [embed],

        ephemeral: true,

      });

    }

    case "panel_clear":

      historyClear(userId);

      memoryClear(userId);

      return interaction.reply({

        content:
          "✅ Histórico e memória apagados.",

        ephemeral: true,

      });

    case "panel_projects": {

      const projects = loadProjects();

      const list = projects[userId] || [];

      const embed = new EmbedBuilder()

        .setColor(SECONDARY)

        .setTitle("📁 Projetos")

        .setDescription(

          list.length

            ? list
                .map((p, i) => `**${i + 1}.** ${p.name || "Projeto"}`)
                .join("\n")

            : "Nenhum projeto salvo."

        );

      return interaction.reply({

        embeds: [embed],

        ephemeral: true,

      });

    }

    case "panel_chat":

      return interaction.reply({

        content:
          "Use **/ia** para conversar comigo.",

        ephemeral: true,

      });

    case "panel_persona": {

      const modal = new ModalBuilder()

        .setCustomId("modal_persona")

        .setTitle("Alterar personalidade");

      const input = new TextInputBuilder()

        .setCustomId("persona_text")

        .setLabel("Nova personalidade")

        .setStyle(TextInputStyle.Paragraph)

        .setRequired(true)

        .setValue(getUser(userId).persona);

      modal.addComponents(

        new ActionRowBuilder().addComponents(input)

      );

      return interaction.showModal(modal);

    }

  }

});


client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  if (!isOwner(userId)) return;

  switch (interaction.customId) {

    case "admin_users": {

      const users = loadUsers();

      const embed = new EmbedBuilder()
        .setColor(SUCCESS)
        .setTitle("👥 Usuários cadastrados")
        .setDescription(
          Object.values(users).length
            ? Object.values(users)
                .slice(0, 30)
                .map(u => `• ${u.tag || u.userId} | ${u.shortId}`)
                .join("\n")
            : "Nenhum usuário encontrado."
        );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });

    }

    case "admin_logs": {

      const log =
        fs.existsSync(FILES.log)
          ? fs.readFileSync(FILES.log, "utf8")
          : "Sem logs.";

      return interaction.reply({

        content:
          "```txt\n" +
          log.slice(-1800) +
          "\n```",

        ephemeral: true,

      });

    }

    case "admin_config": {

      const cfg = loadConfig();

      const embed = new EmbedBuilder()

        .setColor(PRIMARY)

        .setTitle("⚙ Configuração da IA")

        .addFields(

          {
            name: "Modelo",
            value: cfg.ia.model,
            inline: true,
          },

          {
            name: "API",
            value:
              cfg.ia.apiKey
                ? "Configurada"
                : "Não configurada",
            inline: true,
          },

          {
            name: "Temperatura",
            value: String(cfg.ia.temperature),
            inline: true,
          }

        );

      return interaction.reply({

        embeds: [embed],

        ephemeral: true,

      });

    }

    case "admin_payments": {

      const cfg = loadConfig();

      const embed = new EmbedBuilder()

        .setColor(WARNING)

        .setTitle("💳 Pagamentos")

        .addFields(

          {

            name: "Asaas",

            value:
              cfg.payments.asaasApiKey
                ? "Configurado"
                : "Não configurado",

          },

          {

            name: "Webhook",

            value:
              cfg.payments.webhook || "Não definido",

          },

          {

            name: "Ambiente",

            value:
              cfg.payments.environment,

          }

        );

      return interaction.reply({

        embeds: [embed],

        ephemeral: true,

      });

    }

  }

});


client.on(Events.InteractionCreate, async (interaction) => {

  if (!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  /* ===========================
     Alterar personalidade
  =========================== */

  if (interaction.customId === "modal_persona") {

    const persona =
      interaction.fields
        .getTextInputValue("persona_text")
        .trim();

    updateUser(userId, {
      persona,
    });

    return interaction.reply({
      content: "✅ Personalidade atualizada.",
      ephemeral: true,
    });

  }

  /* ===========================
     Adicionar memória
  =========================== */

  if (interaction.customId === "modal_memory") {

    const text =
      interaction.fields
        .getTextInputValue("memory")
        .trim();

    memoryAdd(userId, text);

    return interaction.reply({
      content: "🧠 Memória salva com sucesso.",
      ephemeral: true,
    });

  }

  /* ===========================
     Criar projeto
  =========================== */

  if (interaction.customId === "modal_project") {

    const nome =
      interaction.fields.getTextInputValue("nome");

    const descricao =
      interaction.fields.getTextInputValue("descricao");

    projectSave(userId, {

      name: nome,

      description: descricao,

    });

    return interaction.reply({

      content:
        "📁 Projeto salvo com sucesso.",

      ephemeral: true,

    });

  }

});

client.on(Events.MessageCreate, async (message) => {

  if (message.author.bot) return;

  if (message.guild) return;

  const userId = message.author.id;

  getUser(userId, message.author.tag);

  try {

    const result =
      await askAI(userId, message.content);

    if (result.blocked) {

      return message.reply(result.text);

    }

    const parts =
      splitText(result.text);

    for (const p of parts) {

      await message.reply(p);

    }

  } catch (err) {

    console.error(err);

    message.reply(
      "❌ Erro ao responder."
    );

  }

});

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

client.login(process.env.DISCORD_TOKEN);


const AGENTS = {

  normal: {
    emoji: "🤖",
    name: "Monarch",
    prompt: "Você é a Monarch IA. Inteligente, rápida, educada e responde em português."
  },

  programador: {
    emoji: "💻",
    name: "Programador",
    prompt: "Você é um programador Full Stack especialista em Node.js, Python, React, Next.js, APIs, bancos de dados e Discord Bots. Sempre entregue código completo."
  },

  hacker: {
    emoji: "🛡️",
    name: "Cyber Security",
    prompt: "Você é especialista em segurança da informação, pentest ético, redes, Linux e criptografia. Nunca ensine atividades ilegais."
  },

  designer: {
    emoji: "🎨",
    name: "Designer",
    prompt: "Você é um designer UI/UX especialista em Figma, cores, tipografia e interfaces modernas."
  },

  escritor: {
    emoji: "✍️",
    name: "Escritor",
    prompt: "Você escreve textos profissionais, criativos e bem estruturados."
  },

  professor: {
    emoji: "📚",
    name: "Professor",
    prompt: "Explique qualquer assunto de forma simples, detalhada e didática."
  },

  tradutor: {
    emoji: "🌎",
    name: "Tradutor",
    prompt: "Você traduz textos mantendo contexto, naturalidade e gramática."
  }

};

function getAgent(name){

    return AGENTS[name] || AGENTS.normal;

}

function buildAgentPanel(){

return{

embeds:[

new EmbedBuilder()

.setColor(PRIMARY)

.setTitle("🧠 Agentes Inteligentes")

.setDescription("Escolha um especialista.")

],

components:[

new ActionRowBuilder()

.addComponents(

new ButtonBuilder().setCustomId("agent_programador").setLabel("Programador").setEmoji("💻").setStyle(ButtonStyle.Primary),

new ButtonBuilder().setCustomId("agent_designer").setLabel("Designer").setEmoji("🎨").setStyle(ButtonStyle.Secondary),

new ButtonBuilder().setCustomId("agent_professor").setLabel("Professor").setEmoji("📚").setStyle(ButtonStyle.Success),

new ButtonBuilder().setCustomId("agent_hacker").setLabel("Cyber").setEmoji("🛡️").setStyle(ButtonStyle.Danger)

)

]

};

}


function getCurrentAgent(userId){

    const user = getUser(userId);

    if(!user.agent){

        user.agent="normal";

        updateUser(userId,{agent:"normal"});

    }

    return getAgent(user.agent);

}

function setCurrentAgent(userId,agent){

    updateUser(userId,{
        agent
    });

}

client.on(Events.InteractionCreate,async(interaction)=>{

    if(!interaction.isButton()) return;

    if(!interaction.customId.startsWith("agent_")) return;

    const userId=interaction.user.id;

    const selected=interaction.customId.replace("agent_","");

    if(!AGENTS[selected]){

        return interaction.reply({
            content:"Agente inválido.",
            ephemeral:true
        });

    }

    setCurrentAgent(userId,selected);

    const ag=getAgent(selected);

    return interaction.reply({

        embeds:[

            new EmbedBuilder()

            .setColor(SUCCESS)

            .setTitle(`${ag.emoji} ${ag.name}`)

            .setDescription(

`Especialista ativado com sucesso.

Agora todas as respostas utilizarão este agente automaticamente até você trocar novamente.`

            )

        ],

        ephemeral:true

    });

});

const __askAIOriginal=askAI;

askAI=async function(userId,text,options={}){

    const ag=getCurrentAgent(userId);

    return await __askAIOriginal(userId,text,{
        ...options,
        extraSystem:
`${ag.prompt}

${options.extraSystem||""}`
    });

};


function buildExecutionPlan(text){

    const steps=[

        "Analisar o objetivo",

        "Planejar arquitetura",

        "Criar estrutura de pastas",

        "Gerar arquivos principais",

        "Adicionar funcionalidades",

        "Revisar código",

        "Testar funcionamento",

        "Gerar documentação"

    ];

    return{

        goal:text,

        status:"Em andamento",

        progress:0,

        createdAt:new Date().toISOString(),

        steps:steps.map(step=>({

            title:step,

            done:false

        }))

    };

}

function advanceExecution(plan){

    const next=

        plan.steps.find(s=>!s.done);

    if(next){

        next.done=true;

    }

    const done=

        plan.steps.filter(s=>s.done).length;

    plan.progress=

        Math.floor(

            done*100/

            plan.steps.length

        );

    if(plan.progress>=100){

        plan.status="Concluído";

    }

    return plan;

}

client.on(Events.InteractionCreate,async interaction=>{

    if(!interaction.isButton()) return;

    if(interaction.customId!=="proj_all") return;

    const modal=new ModalBuilder()

        .setCustomId("modal_autonomous_project")

        .setTitle("Modo Autônomo");

    const input=new TextInputBuilder()

        .setCustomId("goal")

        .setLabel("Descreva o projeto")

        .setStyle(TextInputStyle.Paragraph)

        .setRequired(true)

        .setPlaceholder("Ex: Criar um bot Discord completo com painel web.");

    modal.addComponents(

        new ActionRowBuilder()

            .addComponents(input)

    );

    return interaction.showModal(modal);

});

client.on(Events.InteractionCreate,async interaction=>{

    if(!interaction.isModalSubmit()) return;

    if(interaction.customId!=="modal_autonomous_project") return;

    const goal=

        interaction.fields

        .getTextInputValue("goal");

    let plan=

        buildExecutionPlan(goal);

    projectSave(

        interaction.user.id,

        plan

    );

    const embed=

        new EmbedBuilder()

        .setColor(PRIMARY)

        .setTitle("🚀 Projeto iniciado")

        .setDescription(goal)

        .addFields(

            {

                name:"Status",

                value:plan.status,

                inline:true

            },

            {

                name:"Progresso",

                value:plan.progress+"%",

                inline:true

            }

        );

    return interaction.reply({

        embeds:[embed],

        ephemeral:true

    });

});


function createTask(projectId,title,description){

    return{

        id:crypto.randomUUID(),

        projectId,

        title,

        description,

        status:"pendente",

        createdAt:new Date().toISOString(),

        updatedAt:new Date().toISOString()

    };

}

function finishTask(task){

    task.status="concluida";

    task.updatedAt=new Date().toISOString();

    return task;

}

function calculateProjectProgress(project){

    if(!project.tasks) return 0;

    if(project.tasks.length===0) return 0;

    const done=

        project.tasks.filter(t=>t.status==="concluida").length;

    return Math.floor(

        (done/project.tasks.length)*100

    );

}

function addTaskToProject(userId,projectIndex,title,description){

    const projects=loadProjects();

    if(!projects[userId]) return false;

    const project=projects[userId][projectIndex];

    if(!project) return false;

    if(!project.tasks){

        project.tasks=[];

    }

    project.tasks.push(

        createTask(

            project.id,

            title,

            description

        )

    );

    project.progress=

        calculateProjectProgress(project);

    saveProjects(projects);

    return true;

}

function completeTask(userId,projectIndex,taskId){

    const projects=loadProjects();

    const project=projects[userId]?.[projectIndex];

    if(!project) return false;

    const task=

        project.tasks.find(

            t=>t.id===taskId

        );

    if(!task) return false;

    finishTask(task);

    project.progress=

        calculateProjectProgress(project);

    saveProjects(projects);

    return true;

}

function buildTaskEmbed(project){

    return new EmbedBuilder()

        .setColor(PRIMARY)

        .setTitle("📋 Tarefas do Projeto")

        .setDescription(

            project.tasks?.length

            ? project.tasks.map((t,i)=>

                `${t.status==="concluida"?"✅":"⬜"} ${i+1}. ${t.title}`

              ).join("\n")

            : "Nenhuma tarefa cadastrada."

        )

        .addFields({

            name:"Progresso",

            value:`${project.progress||0}%`

        });

}


async function autonomousPlanner(userId, objective){

    const prompt=`

Você é um Arquiteto de Software Sênior.

Divida o projeto abaixo em etapas.

Para cada etapa informe:

- título
- descrição
- prioridade
- dificuldade

Projeto:

${objective}

Responda em JSON.

`;

    const result=await askAI(userId,prompt,{
        countMessage:false,
        extraSystem:"Retorne somente JSON."
    });

    try{

        return JSON.parse(result.text);

    }catch{

        return{

            etapas:[

                {

                    titulo:"Planejamento",

                    descricao:objective,

                    prioridade:"Alta",

                    dificuldade:"Média"

                }

            ]

        };

    }

}

async function createAutonomousProject(userId,text){

    const plan=

        await autonomousPlanner(userId,text);

    const project={

        id:crypto.randomUUID(),

        name:text,

        createdAt:new Date().toISOString(),

        autonomous:true,

        progress:0,

        tasks:[]

    };

    if(Array.isArray(plan.etapas)){

        for(const etapa of plan.etapas){

            project.tasks.push({

                id:crypto.randomUUID(),

                title:etapa.titulo,

                description:etapa.descricao,

                priority:etapa.prioridade,

                difficulty:etapa.dificuldade,

                status:"pendente"

            });

        }

    }

    const projects=loadProjects();

    if(!projects[userId]){

        projects[userId]=[];

    }

    projects[userId].push(project);

    saveProjects(projects);

    return project;

}

function projectStatusEmbed(project){

    return new EmbedBuilder()

    .setColor(PRIMARY)

    .setTitle("🤖 Projeto Autônomo")

    .setDescription(project.name)

    .addFields(

        {

            name:"Progresso",

            value:project.progress+"%",

            inline:true

        },

        {

            name:"Tarefas",

            value:String(project.tasks.length),

            inline:true

        }

    );

}


function createProjectStructure(type){

    switch(type){

        case "discord-bot":

            return{

                folders:[
                    "commands",
                    "events",
                    "handlers",
                    "database",
                    "services",
                    "utils",
                    "logs",
                    "assets"
                ],

                files:[
                    "index.js",
                    "package.json",
                    ".env.example",
                    "README.md",
                    ".gitignore"
                ]

            };

        case "website":

            return{

                folders:[
                    "public",
                    "src",
                    "src/pages",
                    "src/components",
                    "src/assets",
                    "src/styles"
                ],

                files:[
                    "package.json",
                    "README.md",
                    ".env.example"
                ]

            };

        default:

            return{

                folders:[],

                files:[]

            };

    }

}

function attachStructure(project,type){

    const structure=createProjectStructure(type);

    project.structure=structure;

    return project;

}

function buildStructureEmbed(project){

    return new EmbedBuilder()

    .setColor(PRIMARY)

    .setTitle("📁 Estrutura do Projeto")

    .addFields(

        {

            name:"Pastas",

            value:

            project.structure.folders.length

            ? project.structure.folders.map(f=>"📂 "+f).join("\n")

            : "Nenhuma"

        },

        {

            name:"Arquivos",

            value:

            project.structure.files.length

            ? project.structure.files.map(f=>"📄 "+f).join("\n")

            : "Nenhum"

        }

    );

}


async function generateProjectFile(userId, project, fileName){

    const prompt=`

Você é um desenvolvedor sênior.

Projeto:
${project.name}

Arquivo:
${fileName}

Estrutura:
${JSON.stringify(project.structure,null,2)}

Gere SOMENTE o conteúdo completo do arquivo solicitado.

`;

    const result=await askAI(userId,prompt,{
        countMessage:false,
        extraSystem:"Responda apenas com o conteúdo do arquivo."
    });

    return{

        name:fileName,

        content:result.text

    };

}

async function generateAllProjectFiles(userId,project){

    const generated=[];

    if(!project.structure?.files){

        return generated;

    }

    for(const file of project.structure.files){

        try{

            const output=

                await generateProjectFile(
                    userId,
                    project,
                    file
                );

            generated.push(output);

        }catch(err){

            generated.push({

                name:file,

                error:String(err)

            });

        }

    }

    project.generatedFiles=generated;

    return generated;

}

function buildGeneratedFilesEmbed(project){

    return new EmbedBuilder()

        .setColor(SUCCESS)

        .setTitle("📄 Arquivos Gerados")

        .setDescription(

            project.generatedFiles?.length

            ? project.generatedFiles
                .map(f=>`📄 ${f.name}`)
                .join("\n")

            : "Nenhum arquivo gerado."

        );

}


function exportProject(project){

    const output={

        id:project.id,

        name:project.name,

        createdAt:project.createdAt,

        files:[]

    };

    if(Array.isArray(project.generatedFiles)){

        for(const file of project.generatedFiles){

            output.files.push({

                path:file.name,

                content:file.content||""

            });

        }

    }

    return output;

}

function projectToMarkdown(project){

    let md=`# ${project.name}\n\n`;

    md+=`Criado em: ${project.createdAt}\n\n`;

    md+="## Arquivos\n\n";

    if(project.generatedFiles){

        for(const file of project.generatedFiles){

            md+=`### ${file.name}\n\n`;

            md+="```text\n";

            md+=file.content||"";

            md+="\n```\n\n";

        }

    }

    return md;

}

function buildExportEmbed(project){

    return new EmbedBuilder()

        .setColor(SUCCESS)

        .setTitle("📦 Projeto pronto para exportação")

        .setDescription(

            `Projeto **${project.name}** preparado para exportação.`

        )

        .addFields(

            {

                name:"Arquivos",

                value:String(

                    project.generatedFiles?.length||0

                ),

                inline:true

            },

            {

                name:"Status",

                value:"Pronto",

                inline:true

            }

        );

}

