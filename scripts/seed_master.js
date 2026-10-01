const bcrypt = require('bcryptjs');
const db = require('../db');

const ITENS_PADRAO_CUSTOS = [
  'Aluguel do espaço / Cozinha',
  'Água e Esgoto',
  'Energia elétrica',
  'Gás (encanado / botijão)',
  'Internet e Telefone',
  'Produtos de limpeza e higiene',
  'Salário / Pró-labore',
  'Equipamentos / Depreciação',
  'Outros custos fixos'
];

async function seedMaster() {
  await db.rodarMigracoes();

  const email = (process.env.MASTER_EMAIL || 'admin@docepreco.com').toLowerCase().trim();
  const senha = process.env.MASTER_PASSWORD || 'Admin123@#';
  const nome = process.env.MASTER_NOME || 'Administrador Master';

  console.log(`🛡️ Provisionando usuário Master: ${email}...`);

  const senhaHash = bcrypt.hashSync(senha, 10);

  const usuarioExistente = await db.get('SELECT id FROM usuarios WHERE email = ?', [email]);

  if (usuarioExistente) {
    await db.run(`
      UPDATE usuarios 
      SET nome = ?, senha_hash = ?, perfil = 'master', status = 'ativo'
      WHERE id = ?
    `, [nome, senhaHash, usuarioExistente.id]);
    console.log(`✅ Usuário Master atualizado com sucesso (ID: ${usuarioExistente.id})!`);
  } else {
    const info = await db.run(`
      INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
      VALUES (?, ?, ?, 'master', 'ativo')
    `, [nome, email, senhaHash]);
    const uid = Number(info.lastInsertRowid);

    await db.run('INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, 160)', [uid]);

    for (const item of ITENS_PADRAO_CUSTOS) {
      await db.run('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, 0)', [uid, item]);
    }
    console.log(`✅ Novo Usuário Master criado com sucesso (ID: ${uid})!`);
  }

  console.log(`🔑 Credenciais de acesso:`);
  console.log(`   E-mail: ${email}`);
  console.log(`   Senha:  ${senha}`);
}

seedMaster().catch((err) => {
  console.error('❌ Erro ao provisionar usuário master:', err);
  process.exit(1);
});
