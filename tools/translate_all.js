const fs = require('fs');
const path = require('path');
const https = require('https');

async function translate(text, source = 'auto', target = 'zh-CN') {
    return new Promise((resolve) => {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const translated = parsed[0].map(x => x[0]).join('');
                    resolve(translated);
                } catch (e) {
                    resolve(text);
                }
            });
        }).on('error', (e) => {
            resolve(text);
        });
    });
}

const specialTerms = ["Spring Bean", "React Hook", "JWT", "Props", "props", "API", "URL", "JSON", "Go", "golang", "React", "Next.js", "Docker", "REST", "RPC", "gRPC"];

function cleanTranslation(original, translated) {
    let cleaned = translated;
    for (const term of specialTerms) {
        const lowerTerm = term.toLowerCase();
        if (original.toLowerCase().includes(lowerTerm)) {
            const regex = new RegExp(term, 'gi');
            cleaned = cleaned.replace(regex, term);
        }
    }
    return cleaned;
}

function isComment(line, ext, filepath) {
    const stripped = line.trim();
    if (ext === ".sh" || ext === ".yml" || ext === ".yaml" || filepath.endsWith("Dockerfile")) {
        return stripped.startsWith("#") && !stripped.startsWith("#!");
    } else if (ext === ".ts" || ext === ".tsx" || ext === ".java" || ext === ".go") {
        return (stripped.startsWith("//") || stripped.startsWith("/*") || stripped.startsWith("* ")) && !stripped.startsWith("// http");
    } else if (ext === ".xml") {
        return stripped.startsWith("<!--") || stripped.startsWith("*");
    }
    return false;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processFile(filepath) {
    const ext = path.extname(filepath);
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    let isModified = false;
    const newLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (isComment(line, ext, filepath) && /[a-zA-Z]{3,}/.test(line) && !/[\u4e00-\u9fff]/.test(line)) {
            // Skip directives, copyright, and eslint/ts/docker specific machine comments
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes("copyright") ||
                lowerLine.includes("license") ||
                lowerLine.includes("eslint-disable") ||
                lowerLine.includes("@ts-ignore") ||
                lowerLine.includes("@ts-expect-error") ||
                lowerLine.includes("/// <reference") ||
                lowerLine.includes("syntax=docker") ||
                lowerLine.includes("docker-compose") ||
                line.includes("REDIS_PASSWORD") ||
                line.includes("AETHERBLOG")) {
                newLines.push(line);
                continue;
            }

            const match = line.match(/^(\s*(?:\/\/|#|\/\*|\*|<!--)\s*)(.*)$/);
            if (match) {
                const prefix = match[1];
                let textToTranslate = match[2];

                if (textToTranslate.trim() !== '') {
                    const translated = await translate(textToTranslate);
                    const cleaned = cleanTranslation(textToTranslate, translated);

                    if (cleaned && cleaned !== textToTranslate) {
                        newLines.push(prefix + cleaned);
                        isModified = true;
                        await delay(50); // slight delay
                        continue;
                    }
                }
            }
        }
        newLines.push(line);
    }

    if (isModified) {
        fs.writeFileSync(filepath, newLines.join('\n'), 'utf8');
        console.log(`Translated comments in ${filepath}`);
    }
}

async function run() {
    const filesToReprocess = [
        "apps/admin/Dockerfile",
        "apps/blog/Dockerfile",
        "apps/admin/src/vite-env.d.ts",
        "apps/admin/src/lib/ansi.ts",
        "packages/editor/src/bearDecorations.ts",
        "apps/blog/app/team-chat/TeamChatClient.tsx",
        "apps/server-go/config.yaml",
        "docker-compose.prod.yml"
    ];
    for (const file of filesToReprocess) {
        if (fs.existsSync(file)) {
            await processFile(file);
        }
    }
    console.log("Retranslation done.");
}

run();
