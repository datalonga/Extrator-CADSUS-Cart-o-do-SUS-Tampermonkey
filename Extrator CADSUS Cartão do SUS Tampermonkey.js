// ==UserScript==
// @name         Extrator CADSUS (Correção CPF - Modal e Busca)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Captura CPF (do Modal ou Busca), Nome e Data. Botão atualiza dados.
// @author       Você
// @match        *://*/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. ESTILOS (CSS)
    // ============================================================================
    const styles = `
        #tm-extract-btn {
            position: fixed; bottom: 20px; left: 20px; z-index: 99999;
            background-color: #0056b3; color: white; border: none; border-radius: 30px;
            padding: 0 24px; height: 50px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            cursor: pointer; font-size: 14px; font-weight: bold; text-transform: uppercase;
            letter-spacing: 0.5px; display: flex; align-items: center; justify-content: center;
            transition: all 0.2s ease; font-family: 'Segoe UI', sans-serif;
        }
        #tm-extract-btn:hover { transform: translateY(-2px); background-color: #004494; box-shadow: 0 6px 15px rgba(0,0,0,0.4); }

        #tm-modal-overlay {
            position: fixed; bottom: 85px; left: 20px; width: 360px;
            background-color: #ffffff; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.25);
            z-index: 99999; font-family: 'Segoe UI', sans-serif; border: 1px solid #ddd;
            display: none; flex-direction: column; overflow: hidden;
            animation: tmFadeIn 0.3s ease-out;
        }
        @keyframes tmFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .tm-modal-header { background-color: #f8f9fa; padding: 15px; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
        .tm-modal-header h3 { margin: 0; font-size: 16px; color: #333; font-weight: 700; }
        .tm-close-btn { background: none; border: none; font-size: 24px; line-height: 0.8; cursor: pointer; color: #999; }
        .tm-close-btn:hover { color: #d00; }

        .tm-modal-body { padding: 15px; }
        .tm-data-row { margin-bottom: 15px; }
        .tm-label { display: block; font-size: 11px; font-weight: bold; color: #666; margin-bottom: 5px; text-transform: uppercase; }

        .tm-input-group { display: flex; border: 1px solid #ccc; border-radius: 5px; overflow: hidden; }
        .tm-input-value { flex-grow: 1; padding: 8px 10px; border: none; background: #fff; color: #333; font-size: 14px; outline: none; font-weight: 500; }

        .tm-copy-btn {
            padding: 0 15px; background-color: #28a745; color: white; border: none;
            cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap;
            transition: background 0.2s;
        }
        .tm-copy-btn:hover { background-color: #218838; }
        .tm-copy-btn.disabled { background-color: #ccc; cursor: not-allowed; }
    `;

    if (typeof GM_addStyle !== 'undefined') GM_addStyle(styles);
    else {
        const styleSheet = document.createElement("style");
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }

    // ============================================================================
    // 2. FUNÇÕES AUXILIARES
    // ============================================================================

    const getValueBySelector = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        // Prioriza value (input), depois innerText (b, span, div)
        return (el.value || el.innerText || el.textContent || "").trim();
    };

    const copyToClipboard = async (text, btn) => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            const originalText = btn.innerText;
            btn.innerText = "Copiado!";
            btn.style.backgroundColor = "#17a2b8";
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.backgroundColor = "";
            }, 1200);
        } catch (err) {
            btn.innerText = "Erro";
            btn.style.backgroundColor = "#dc3545";
        }
    };

    // --- LÓGICA REFINADA PARA ENCONTRAR O CPF NO CADSUS ---
    const findCpfValue = () => {
        let val = "";

        // 1. Prioridade Máxima: O elemento <b id="cpf"> dentro do Modal de Visualização
        // O HTML mostra: <b id="cpf" class="texto">...</b>
        const elModal = document.getElementById('cpf');
        if (elModal) {
            val = elModal.innerText || elModal.textContent || "";
            if (val.replace(/\D/g, '').length > 0) return val;
        }

        // 2. Segunda Tentativa: O campo de busca "Número do Documento"
        // Caso o usuário tenha pesquisado pelo CPF e não tenha aberto o modal ainda
        const elBusca = document.getElementById('numeroDocumento');
        if (elBusca) {
            val = elBusca.value || "";
            if (val.replace(/\D/g, '').length > 0) return val;
        }

        // 3. Fallback: XPath Genérico (como solicitado anteriormente)
        try {
            const result = document.evaluate('//*[@id="cpf"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const elXpath = result.singleNodeValue;
            if (elXpath) {
                val = elXpath.value || elXpath.innerText || "";
                if (val.replace(/\D/g, '').length > 0) return val;
            }
        } catch (e) { console.log(e); }

        return "";
    };

    // --- LÓGICA PARA NOME E DATA (TABELA VS MODAL) ---
    // Tenta pegar do modal primeiro (mais preciso), senão pega da tabela de fundo
    const findGenericValue = (idModal, classTabela) => {
        // Tenta ID (Modal)
        let el = document.getElementById(idModal);
        if (el) {
            let val = el.innerText || el.textContent || "";
            if (val.trim()) return val;
        }
        // Tenta Classe (Tabela de Resultados)
        return getValueBySelector(classTabela);
    };

    // ============================================================================
    // 3. INTERFACE (UI)
    // ============================================================================

    const createUI = () => {
        if (document.getElementById('tm-extract-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'tm-extract-btn';
        btn.innerText = 'Capturar Dados';
        btn.onclick = openOrRefreshModal; // Clicar sempre atualiza/abre
        document.body.appendChild(btn);

        const modal = document.createElement('div');
        modal.id = 'tm-modal-overlay';
        modal.innerHTML = `
            <div class="tm-modal-header">
                <h3>Dados do Paciente</h3>
                <button class="tm-close-btn" id="tm-close-modal">×</button>
            </div>
            <div class="tm-modal-body" id="tm-modal-content"></div>
        `;
        document.body.appendChild(modal);

        document.getElementById('tm-close-modal').onclick = () => {
            modal.style.display = 'none';
        };
    };

    const renderModalContent = () => {
        const contentDiv = document.getElementById('tm-modal-content');
        contentDiv.innerHTML = '';

        const fields = [
            {
                key: 'cpf',
                label: 'CPF (Somente Números)',
                getValue: () => {
                    const raw = findCpfValue();
                    return raw ? raw.replace(/\D/g, '') : '';
                }
            },
            {
                key: 'nome',
                label: 'Nome Completo',
                // Tenta pegar id="nome" (modal) ou .resultadoNome (tabela)
                getValue: () => findGenericValue('nome', '.resultadoNome') || ''
            },
            {
                key: 'dataNascimento',
                label: 'Data de Nascimento',
                // Tenta pegar id="dataNascimento" (modal) ou .resultadoDataNascimento (tabela)
                getValue: () => findGenericValue('dataNascimento', '.resultadoDataNascimento') || ''
            }
        ];

        let foundData = false;

        fields.forEach(field => {
            const value = field.getValue();
            if (value) foundData = true;

            const row = document.createElement('div');
            row.className = 'tm-data-row';
            const btnClass = value ? '' : 'disabled';

            row.innerHTML = `
                <span class="tm-label">${field.label}</span>
                <div class="tm-input-group">
                    <input type="text" class="tm-input-value" value="${value}" readonly>
                    <button class="tm-copy-btn ${btnClass}">Copiar</button>
                </div>
            `;

            if (value) {
                const copyBtn = row.querySelector('.tm-copy-btn');
                const inputEl = row.querySelector('.tm-input-value');
                copyBtn.onclick = () => copyToClipboard(inputEl.value, copyBtn);
            }

            contentDiv.appendChild(row);
        });

        if (!foundData) {
            contentDiv.innerHTML += `
                <div style="text-align:center; color:#d00; margin-top:10px; font-size:12px;">
                    Nenhum dado encontrado.<br>
                    <b>Dica:</b> Abra a janela "Visualizar Dados" (ícone de olho) antes de capturar.
                </div>`;
        }
    };

    const openOrRefreshModal = () => {
        const modal = document.getElementById('tm-modal-overlay');
        renderModalContent(); // Recarrega os dados do DOM atual
        if (modal.style.display !== 'flex') {
            modal.style.display = 'flex';
        }
    };

    setTimeout(createUI, 1500);

})();