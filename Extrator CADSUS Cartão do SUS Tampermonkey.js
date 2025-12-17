// ==UserScript==
// @name         Extrator SUS (Ordem Corrigida + Botão Texto)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Botão "Capturar Dados" -> Extrai CPF, Nome e Data (nesta ordem).
// @author       SeuNome
// @match        https://cadastro.saude.gov.br/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. ESTILOS (CSS) - Ajustado para botão com texto
    // ============================================================================
    const styles = `
        /* Botão Flutuante (Agora com texto) */
        #tm-extract-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            background-color: #0056b3;
            color: white;
            border: none;
            border-radius: 30px; /* Arredondado estilo "Pílula" */
            padding: 0 24px;     /* Espaçamento interno lateral */
            height: 50px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            font-family: 'Segoe UI', sans-serif;
        }
        #tm-extract-btn:hover {
            transform: translateY(-2px);
            background-color: #004494;
            box-shadow: 0 6px 15px rgba(0,0,0,0.4);
        }

        /* Modal Container */
        #tm-modal-overlay {
            position: fixed;
            bottom: 85px; /* Um pouco acima do botão */
            right: 20px;
            width: 360px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.25);
            z-index: 99999;
            font-family: 'Segoe UI', sans-serif;
            border: 1px solid #ddd;
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: tmFadeIn 0.3s ease-out;
        }
        @keyframes tmFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* Cabeçalho do Modal */
        .tm-modal-header {
            background-color: #f8f9fa;
            padding: 15px;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tm-modal-header h3 { margin: 0; font-size: 16px; color: #333; font-weight: 700; }
        .tm-close-btn { background: none; border: none; font-size: 24px; line-height: 0.8; cursor: pointer; color: #999; }
        .tm-close-btn:hover { color: #d00; }

        /* Corpo do Modal */
        .tm-modal-body { padding: 15px; }
        .tm-data-row { margin-bottom: 15px; }
        .tm-label { display: block; font-size: 11px; font-weight: bold; color: #666; margin-bottom: 5px; text-transform: uppercase; }

        /* Grupo Input + Botão Copiar */
        .tm-input-group { display: flex; border: 1px solid #ccc; border-radius: 5px; overflow: hidden; }
        .tm-input-value {
            flex-grow: 1; padding: 8px 10px; border: none; background: #fff;
            color: #333; font-size: 14px; outline: none; font-weight: 500;
        }
        .tm-copy-btn {
            padding: 0 15px; background-color: #28a745; color: white; border: none;
            cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap;
            transition: background 0.2s;
        }
        .tm-copy-btn:hover { background-color: #218838; }
    `;

    if (typeof GM_addStyle !== 'undefined') GM_addStyle(styles);
    else {
        const styleSheet = document.createElement("style");
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }

    // ============================================================================
    // 2. LÓGICA
    // ============================================================================

    const getTextBySelector = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return "";
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
            console.error('Erro ao copiar:', err);
        }
    };

    // ============================================================================
    // 3. INTERFACE (UI)
    // ============================================================================

    const createUI = () => {
        // CRIA O BOTÃO COM TEXTO
        const btn = document.createElement('button');
        btn.id = 'tm-extract-btn';
        btn.innerText = 'Capturar Dados'; // Texto alterado
        btn.onclick = toggleModal;
        document.body.appendChild(btn);

        // CRIA O MODAL
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

    const toggleModal = () => {
        const modal = document.getElementById('tm-modal-overlay');
        const contentDiv = document.getElementById('tm-modal-content');

        if (modal.style.display === 'flex') {
            modal.style.display = 'none';
            return;
        }

        // --- CONFIGURAÇÃO E ORDEM DOS CAMPOS ---
        // Alterada a ordem do array para: CPF -> Nome -> Data
        const fields = [
            {
                key: 'cpf',
                label: 'CPF (Somente Números)',
                selector: '#cpf' // ID
            },
            {
                key: 'nome',
                label: 'Nome Completo',
                selector: '.resultadoNome' // CLASSE
            },
            {
                key: 'dataNascimento',
                label: 'Data de Nascimento',
                selector: '.resultadoDataNascimento' // CLASSE
            }
        ];

        contentDiv.innerHTML = '';

        fields.forEach(field => {
            let value = getTextBySelector(field.selector);

            // Se for CPF, remove pontuação
            if (field.key === 'cpf' && value) {
                value = value.replace(/\D/g, '');
            }

            const row = document.createElement('div');
            row.className = 'tm-data-row';

            // Se não tiver valor, desabilita visualmente o botão
            const btnState = value ? '' : 'style="background-color:#ccc;cursor:not-allowed"';

            row.innerHTML = `
                <span class="tm-label">${field.label}</span>
                <div class="tm-input-group">
                    <input type="text" class="tm-input-value" value="${value}" readonly>
                    <button class="tm-copy-btn" ${btnState}>Copiar</button>
                </div>
            `;

            if (value) {
                const copyBtn = row.querySelector('.tm-copy-btn');
                copyBtn.onclick = () => copyToClipboard(value, copyBtn);
            }

            contentDiv.appendChild(row);
        });

        modal.style.display = 'flex';
    };

    // Inicialização
    setTimeout(() => {
        createUI();
    }, 1500);

})();