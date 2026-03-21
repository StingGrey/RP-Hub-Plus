#!/usr/bin/env node
'use strict';

const readline = require('readline');
const argon2 = require('argon2');
const db = require('./db');

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log('=== Roleplay Hub — 用户创建 ===\n');

    // Check if user already exists
    const existing = db.prepare('SELECT username FROM users').get();
    if (existing) {
        const confirm = await ask(`已存在用户 "${existing.username}"，是否覆盖？(y/N) `);
        if (confirm.toLowerCase() !== 'y') {
            console.log('已取消');
            rl.close();
            process.exit(0);
        }
    }

    const username = process.argv.includes('--username')
        ? process.argv[process.argv.indexOf('--username') + 1]
        : await ask('用户名: ');

    if (!username || username.trim().length === 0) {
        console.error('用户名不能为空');
        rl.close();
        process.exit(1);
    }

    const password = process.argv.includes('--password')
        ? process.argv[process.argv.indexOf('--password') + 1]
        : await ask('密码 (至少8位): ');

    if (!password || password.length < 8) {
        console.error('密码至少需要 8 个字符');
        rl.close();
        process.exit(1);
    }

    console.log('\n正在生成密码哈希...');
    const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,    // 64 MB
        timeCost: 3,
        parallelism: 4
    });

    db.prepare('DELETE FROM users').run(); // Single user mode
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username.trim(), hash);

    console.log(`\n用户 "${username.trim()}" 创建成功！`);
    console.log('现在可以启动服务器: npm start');

    rl.close();
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
