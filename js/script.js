(() => {
    // ========== CONFIGURAÇÃO ==========
    const API_URL = 'https://al-anon.org.br/api/cadastro_grupos.php';
    const LOCATIONIQ_KEY = 'pk.e0313d2db1366ca073ba2189fc75d981';
    const CACHE_KEY = 'alanon_enderecos_coords';
    const CACHE_VERSION = 'v2';

    let todosLocais = null;
    let locaisDoEstado = [];
    let filtroAtivo = 'todos';
    let ufAtiva = null;
    let mapaLeaflet = null;
    let mapaMarker = null;

    // Estado de navegação por cidades
    let modoCidades = false;
    let cidadeSelecionada = null;
    let nomeCidadeSelecionada = null;
    let nomeEstadoAtivo = null;

    // Elementos DOM
    const painel = document.getElementById('painel-grupos');
    const overlay = document.getElementById('overlay');
    const btnFechar = document.getElementById('btn-fechar');
    const listaEl = document.getElementById('lista-grupos');
    const tituloEl = document.getElementById('painel-titulo-texto');
    const bandeiraEl = document.getElementById('painel-bandeira');
    const buscaEl = document.getElementById('busca-grupo');
    const contadorEl = document.getElementById('contador-grupos');
    const filtrosBtns = document.querySelectorAll('.filtro-btn');

    const modalOverlay = document.getElementById('modal-overlay');
    const modalBtnFechar = document.getElementById('modal-btn-fechar');
    const modalTitulo = document.getElementById('modal-grupo-titulo');
    const modalBadge = document.getElementById('modal-badge-tipo');
    const modalCidadeUF = document.getElementById('modal-cidade-uf');
    const modalInfos = document.getElementById('modal-infos-conteudo');
    const modalAcoes = document.getElementById('modal-mapa-acoes');

    const modalMapaGeral = document.getElementById('modal-mapa-geral');
    const btnMapaGeral = document.getElementById('btn-mapa-geral');
    const btnFecharMapaGeral = document.getElementById('btn-fechar-mapa-geral');
    let mapaGeral = null;
    let clusterGroup = null;

    const modalPesquisa = document.getElementById('modal-pesquisa');
    const btnPesquisa = document.getElementById('btn-pesquisa');
    const btnFecharPesquisa = document.getElementById('btn-fechar-pesquisa');
    const pesquisaInput = document.getElementById('pesquisa-input');
    const pesquisaResultados = document.getElementById('pesquisa-resultados');

    let modoTipoAtivo = false;
    let tipoFiltro = null;

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function nomeGrupo(local) {
        return local.gr_nome || 'Grupo sem nome';
    }

    async function geocodificarLocationIQ(query) {
        const url = `https://us1.locationiq.com/v1/search.php?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br&accept-language=pt-BR`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const data = await resp.json();
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                return { lat, lng: lon };
            }
        } catch (e) {
            console.warn('Erro no LocationIQ:', e);
        }
        return null;
    }

    async function geocodificarEndereco(endereco) {
        if (!endereco || endereco.trim() === '') return null;
        const coords = await geocodificarLocationIQ(endereco);
        if (coords) return coords;
        const cidadeUf = endereco.split(',').slice(-2).join(',').trim();
        if (cidadeUf !== endereco) {
            return await geocodificarLocationIQ(cidadeUf);
        }
        return null;
    }

    function getCachedCoords(local) {
        try {
            const cache = localStorage.getItem(CACHE_KEY);
            if (!cache) return null;
            const data = JSON.parse(cache);
            if (data.version !== CACHE_VERSION) return null;
            const key = local.codigo ? `id_${local.codigo}` : local.gr_local?.replace(/\s/g, '_');
            if (data.coords[key] && data.coords[key].expires > Date.now()) {
                return data.coords[key].coords;
            }
        } catch (e) { }
        return null;
    }

    function setCachedCoords(local, coords) {
        try {
            let cache = localStorage.getItem(CACHE_KEY);
            let data = cache ? JSON.parse(cache) : { version: CACHE_VERSION, coords: {} };
            if (data.version !== CACHE_VERSION) data = { version: CACHE_VERSION, coords: {} };
            const key = local.codigo ? `id_${local.codigo}` : local.gr_local?.replace(/\s/g, '_');
            data.coords[key] = {
                coords: coords,
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (e) { }
    }

    function montarEnderecoCompleto(local) {
        const partes = [];
        if (local.gr_endereco) partes.push(local.gr_endereco);
        if (local.gr_numero) partes.push(local.gr_numero);
        if (local.gr_complemento) partes.push(local.gr_complemento);
        if (local.gr_bairro) partes.push(local.gr_bairro);
        if (local.gr_cidade) partes.push(local.gr_cidade);
        if (local.gr_uf) partes.push(local.gr_uf);
        if (local.gr_cep) partes.push(local.gr_cep);
        partes.push('Brasil');
        return partes.join(', ');
    }

    function abrirPainel() {
        overlay.style.display = 'block';
        painel.classList.add('aberto');
        document.body.style.overflow = 'hidden';
        buscaEl.focus();
    }

    function fecharPainelOriginal() {
        painel.classList.remove('aberto');
        overlay.style.display = 'none';
        document.body.style.overflow = '';
        document.querySelectorAll('.estado.ativo').forEach(e => e.classList.remove('ativo'));
        ufAtiva = null;
        modoCidades = false;
        cidadeSelecionada = null;
        nomeCidadeSelecionada = null;
        nomeEstadoAtivo = null;
        esconderBotaoVoltar();
        mostrarFiltros();
        buscaEl.placeholder = 'Buscar por nome, cidade ou bairro…';
        listaEl.classList.remove('cidades-grid');
    }

    let fecharPainel = fecharPainelOriginal;

    btnFechar.addEventListener('click', () => fecharPainel());
    overlay.addEventListener('click', () => fecharPainel());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal() || fecharPainel(); });

    function abrirModal() { modalOverlay.classList.add('visivel'); }
    function fecharModal() {
        if (!modalOverlay.classList.contains('visivel')) return false;
        modalOverlay.classList.remove('visivel');
        return true;
    }
    modalBtnFechar.addEventListener('click', fecharModal);
    modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) fecharModal(); });

    function inicializarMapaSeNecessario() {
        if (!mapaLeaflet) {
            mapaLeaflet = L.map('modal-mapa').setView([-15.78, -47.93], 5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19
            }).addTo(mapaLeaflet);
        }
    }

    async function abrirModalLocal(local) {
        const nome = nomeGrupo(local);
        let badgeHtml = '';
        if (local.grupo_tipo === 'Al-Anon') badgeHtml = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
        else if (local.grupo_tipo === 'Alateen') badgeHtml = '<span class="grupo-badge badge-alateen">Alateen</span>';
        else if (local.grupo_tipo === 'Eletrônico') badgeHtml = '<span class="grupo-badge badge-eletronico">Eletrônico</span>';
        else if (local.grupo_tipo === 'Comitê') badgeHtml = '<span class="grupo-badge badge-comite">Comitê</span>';
        else badgeHtml = '<span class="grupo-badge badge-alanon">Al-Anon</span>';

        modalTitulo.textContent = nome;
        modalBadge.innerHTML = badgeHtml;
        modalCidadeUF.textContent = [local.gr_cidade, local.gr_uf].filter(Boolean).join(' - ');

        const endereco = montarEnderecoCompleto(local);
        const endNav = encodeURIComponent(endereco || nome + ' Brasil');

        let infoHTML = '';
        if (local.gr_local) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">Local da Reunião</div>`;
            infoHTML += linha('🏛️', local.gr_local);
            infoHTML += `</div>`;
        }
        let reuniaoText = '';
        if (local.gr_reuniao && local.gr_reuniao.trim()) reuniaoText += local.gr_reuniao.trim();
        if (local.reuniao && local.reuniao.trim()) {
            if (reuniaoText) reuniaoText += ' | ';
            reuniaoText += local.reuniao.trim();
        }
        if (reuniaoText) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">🗓️ Reuniões</div>`;
            infoHTML += linha('⏰', reuniaoText);
            infoHTML += `</div>`;
        }
        if (local.reuniao_obs && local.reuniao_obs.trim()) {
            infoHTML += linha('📝', local.reuniao_obs);
        }
        if (local.gr_endereco || local.gr_numero || local.gr_bairro) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">Endereço</div>`;
            if (local.gr_endereco) infoHTML += linha('🏠', `${local.gr_endereco}${local.gr_numero ? ', ' + local.gr_numero : ''}`);
            if (local.gr_bairro) infoHTML += linha('🏘️', local.gr_bairro);
            if (local.gr_cidade && local.gr_uf) infoHTML += linha('🌆', `${local.gr_cidade} - ${local.gr_uf}`);
            if (local.gr_cep) infoHTML += linha('📮', local.gr_cep);
            infoHTML += `</div>`;
        }
        if (local.gr_email || local.gr_telefone || local.gr_celular) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">📞 Contatos</div>`;
            if (local.gr_email) infoHTML += linha('✉️', `<a href="mailto:${local.gr_email}">${local.gr_email}</a>`);
            if (local.gr_telefone) infoHTML += linha('📞', local.gr_telefone);
            if (local.gr_celular) infoHTML += linha('📱', local.gr_celular);
            infoHTML += `</div>`;
        }
        modalInfos.innerHTML = infoHTML;

        // Agora grupos do tipo "Eletrônico" e "Comitê" são tratados como online (sem mapa)
        const isOnline = (local.grupo_tipo === 'Eletrônico' || local.grupo_tipo === 'Comitê');
        const modalMapaWrap = document.querySelector('.modal-mapa-wrap');
        const modalMapaDiv = document.getElementById('modal-mapa');
        const modalMapaAcoes = document.getElementById('modal-mapa-acoes');

        if (isOnline) {
            if (modalMapaDiv) modalMapaDiv.style.display = 'none';
            if (modalMapaAcoes) modalMapaAcoes.innerHTML = '';
            let onlineInfoDiv = document.getElementById('online-info-block');
            if (onlineInfoDiv) onlineInfoDiv.remove();
            onlineInfoDiv = document.createElement('div');
            onlineInfoDiv.id = 'online-info-block';
            onlineInfoDiv.className = 'online-info-block';
            if (modalMapaWrap) modalMapaWrap.appendChild(onlineInfoDiv);
            let onlineHtml = `<div class="modal-secao"><div class="modal-secao-titulo">🌐 Reunião Online</div>`;
            if (local.reuniao_url && local.reuniao_url.trim() !== '') {
                onlineHtml += `<div class="modal-linha"><span class="icone-linha">🔗</span><a href="${esc(local.reuniao_url)}" target="_blank" rel="noopener">Acessar reunião online</a></div>`;
            } else {
                onlineHtml += `<div class="modal-linha"><span class="icone-linha">⚠️</span><span>URL de acesso não informada.</span></div>`;
            }
            onlineHtml += `</div>`;
            onlineInfoDiv.innerHTML = onlineHtml;
            onlineInfoDiv.style.display = 'block';
            if (mapaMarker && mapaLeaflet) mapaLeaflet.removeLayer(mapaMarker);
            abrirModal();
            setTimeout(() => { if (mapaLeaflet) mapaLeaflet.invalidateSize(); }, 120);
            return;
        }

        if (modalMapaDiv) modalMapaDiv.style.display = 'block';
        const onlineBlock = document.getElementById('online-info-block');
        if (onlineBlock) onlineBlock.style.display = 'none';
        if (modalMapaAcoes) {
            modalMapaAcoes.innerHTML = `
                <a class="btn-mapa-acao google" href="https://www.google.com/maps/search/?api=1&query=${endNav}" target="_blank" rel="noopener">🗺️ Google Maps</a>
                <a class="btn-mapa-acao waze" href="https://waze.com/ul?q=${endNav}" target="_blank" rel="noopener">🔵 Waze</a>
            `;
        }

        abrirModal();
        inicializarMapaSeNecessario();
        setTimeout(() => mapaLeaflet.invalidateSize(), 120);

        let coords = null;
        if (local.mapa_latitude && local.mapa_longitude) {
            coords = { lat: parseFloat(local.mapa_latitude), lng: parseFloat(local.mapa_longitude) };
        } else {
            const cached = getCachedCoords(local);
            if (cached) {
                coords = cached;
            } else {
                const enderecoGeo = [local.gr_endereco, local.gr_numero, local.gr_bairro, local.gr_cidade, local.gr_uf, 'Brasil'].filter(Boolean).join(', ');
                coords = await geocodificarEndereco(enderecoGeo);
                if (coords) setCachedCoords(local, coords);
            }
        }

        if (mapaMarker) mapaLeaflet.removeLayer(mapaMarker);
        if (coords) {
            mapaLeaflet.setView([coords.lat, coords.lng], 16);
            mapaMarker = L.marker([coords.lat, coords.lng])
                .addTo(mapaLeaflet)
                .bindPopup(`<strong>${esc(nome)}</strong><br>${esc(endereco)}`)
                .openPopup();
        } else {
            mapaLeaflet.setView([-15.78, -47.93], 5);
            mapaMarker = L.marker([-15.78, -47.93])
                .addTo(mapaLeaflet)
                .bindPopup(`⚠️ Endereço não localizado no mapa.<br>Use os botões abaixo para navegar.`)
                .openPopup();
        }
        setTimeout(() => mapaLeaflet.invalidateSize(), 150);
    }

    function linha(icone, texto) {
        return `<div class="modal-linha"><span class="icone-linha">${icone}</span><span>${esc(texto)}</span></div>`;
    }

    // ========== CARREGAR DADOS DA API ==========
    async function carregarDados() {
        if (todosLocais !== null) return todosLocais;
        const resp = await fetch(API_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!json.success) throw new Error(json.message || 'Erro desconhecido');
        todosLocais = Array.isArray(json.data) ? json.data : [];
        return todosLocais;
    }

    // ========== HELPERS BOTÃO VOLTAR / FILTROS / BUSCA ==========
    function criarBotaoVoltar() {
        let btn = document.getElementById('btn-voltar-cidades');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-voltar-cidades';
            btn.innerHTML = '← Voltar para cidades';
            btn.addEventListener('click', voltarParaCidades);
            const painelFiltros = document.querySelector('.painel-filtros');
            painelFiltros.parentNode.insertBefore(btn, painelFiltros);
        }
        btn.style.display = 'block';
    }

    function esconderBotaoVoltar() {
        const btn = document.getElementById('btn-voltar-cidades');
        if (btn) btn.style.display = 'none';
    }

    function mostrarFiltros() {
        const painelFiltros = document.querySelector('.painel-filtros');
        if (painelFiltros) painelFiltros.style.display = 'flex';
    }

    function esconderFiltros() {
        const painelFiltros = document.querySelector('.painel-filtros');
        if (painelFiltros) painelFiltros.style.display = 'none';
    }

    // ========== LISTAR CIDADES DO ESTADO (com grid de duas colunas) ==========
    function renderizarCidades() {
        listaEl.classList.add('cidades-grid');

        const busca = buscaEl.value.trim().toLowerCase();
        const cidadesMap = {};
        locaisDoEstado.forEach(local => {
            const cidade = (local.gr_cidade || 'Cidade não informada').trim();
            if (!cidadesMap[cidade]) cidadesMap[cidade] = [];
            cidadesMap[cidade].push(local);
        });

        let cidades = Object.keys(cidadesMap).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        if (busca) {
            cidades = cidades.filter(c => c.toLowerCase().includes(busca));
        }

        contadorEl.textContent = cidades.length === 0
            ? 'Nenhuma cidade encontrada.'
            : `${cidades.length} cidade${cidades.length > 1 ? 's' : ''} encontrada${cidades.length > 1 ? 's' : ''}.`;

        if (cidades.length === 0) {
            listaEl.innerHTML = `<div class="estado-msg"><div class="icone">🔍</div><p>Nenhuma cidade encontrada<br>com essa busca.</p></div>`;
            return;
        }

        listaEl.innerHTML = cidades.map(cidade => {
            const grupos = cidadesMap[cidade];
            const total = grupos.length;
            const tipoCount = {};
            grupos.forEach(g => {
                const tipo = g.grupo_tipo || 'Al-Anon';
                tipoCount[tipo] = (tipoCount[tipo] || 0) + 1;
            });
            const badgesHtml = Object.entries(tipoCount).map(([tipo, qtd]) => {
                let cls = 'badge-alanon';
                if (tipo === 'Alateen') cls = 'badge-alateen';
                else if (tipo === 'Eletrônico') cls = 'badge-eletronico';
                else if (tipo === 'Comitê') cls = 'badge-comite';
                return `<span class="grupo-badge ${cls}">${qtd} ${esc(tipo)}</span>`;
            }).join('');

            return `
            <div class="grupo-card cidade-card" data-cidade="${esc(cidade)}">
                <div class="cidade-card-topo">
                    <div class="cidade-nome">📍 ${esc(cidade)}</div>
                    <span class="cidade-total">${total} grupo${total > 1 ? 's' : ''}</span>
                </div>
                <div class="cidade-badges">${badgesHtml}</div>
                <div class="hint-clique">Clique para ver os grupos</div>
            </div>`;
        }).join('');

        document.querySelectorAll('.cidade-card').forEach(card => {
            const handler = () => {
                const nomeCidade = card.dataset.cidade;
                selecionarCidade(nomeCidade, cidadesMap[nomeCidade]);
            };
            card.addEventListener('click', handler);
        });
    }

    // ========== SELECIONAR CIDADE E MOSTRAR GRUPOS ==========
    function selecionarCidade(cidade, grupos) {
        cidadeSelecionada = cidade;
        nomeCidadeSelecionada = cidade;
        modoCidades = false;

        tituloEl.textContent = `${cidade} - ${ufAtiva}`;
        criarBotaoVoltar();
        mostrarFiltros();
        buscaEl.value = '';
        buscaEl.placeholder = 'Buscar por nome, bairro…';
        locaisDoEstado = grupos;
        filtroAtivo = 'todos';
        filtrosBtns.forEach(b => b.classList.toggle('ativo', b.dataset.filtro === 'todos'));
        renderizar();
    }

    // ========== VOLTAR PARA LISTA DE CIDADES ==========
    function voltarParaCidades() {
        modoCidades = true;
        cidadeSelecionada = null;
        nomeCidadeSelecionada = null;
        tituloEl.textContent = `Cidades em ${nomeEstadoAtivo}`;
        esconderBotaoVoltar();
        esconderFiltros();
        buscaEl.value = '';
        buscaEl.placeholder = 'Buscar cidade…';
        carregarDados().then(dados => {
            locaisDoEstado = dados.filter(local => (local.gr_uf || '').toUpperCase() === ufAtiva.toUpperCase());
            renderizarCidades();
        });
    }

    // ========== RENDERIZAR GRUPOS (uma coluna) ==========
    function renderizar() {
        listaEl.classList.remove('cidades-grid');

        const busca = buscaEl.value.trim().toLowerCase();
        let filtrados = locaisDoEstado;
        if (filtroAtivo !== 'todos') {
            filtrados = filtrados.filter(local => local.grupo_tipo === filtroAtivo);
        }
        if (busca) {
            filtrados = filtrados.filter(local => {
                const haystack = [
                    nomeGrupo(local),
                    local.gr_local,
                    local.gr_cidade,
                    local.gr_bairro,
                    local.gr_endereco,
                    local.gr_telefone,
                    local.gr_celular,
                    local.gr_email
                ].join(' ').toLowerCase();
                return haystack.includes(busca);
            });
        }
        contadorEl.textContent = filtrados.length === 0
            ? 'Nenhum grupo encontrado.'
            : `${filtrados.length} grupo${filtrados.length > 1 ? 's' : ''} encontrado${filtrados.length > 1 ? 's' : ''}.`;
        if (filtrados.length === 0) {
            listaEl.innerHTML = `<div class="estado-msg"><div class="icone">🔍</div><p>Nenhum grupo encontrado<br>com esses filtros.</p></div>`;
            return;
        }
        listaEl.innerHTML = filtrados.map((local, idx) => {
            let badge = '';
            if (local.grupo_tipo === 'Al-Anon') badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            else if (local.grupo_tipo === 'Alateen') badge = '<span class="grupo-badge badge-alateen">Alateen</span>';
            else if (local.grupo_tipo === 'Eletrônico') badge = '<span class="grupo-badge badge-eletronico">Eletrônico</span>';
            else if (local.grupo_tipo === 'Comitê') badge = '<span class="grupo-badge badge-comite">Comitê</span>';
            else badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            const endereco = [local.gr_endereco, local.gr_numero, local.gr_bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.gr_cidade, local.gr_uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-idx="${idx}">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.gr_local ? `<span><span class="rotulo">Local:</span> ${esc(local.gr_local)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                        ${local.gr_telefone ? `<span><span class="rotulo">Telefone:</span> ${esc(local.gr_telefone)}</span>` : ''}
                        ${local.gr_celular ? `<span><span class="rotulo">Celular:</span> ${esc(local.gr_celular)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');

        document.querySelectorAll('.grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.idx);
            const handler = () => {
                const busca2 = buscaEl.value.trim().toLowerCase();
                let filtrados2 = locaisDoEstado;
                if (filtroAtivo !== 'todos') filtrados2 = filtrados2.filter(l => l.grupo_tipo === filtroAtivo);
                if (busca2) filtrados2 = filtrados2.filter(l => [nomeGrupo(l), l.gr_local, l.gr_cidade, l.gr_bairro, l.gr_endereco].join(' ').toLowerCase().includes(busca2));
                if (filtrados2[idx]) abrirModalLocal(filtrados2[idx]);
            };
            card.addEventListener('click', handler);
        });
    }

    // ========== MODO TIPO (Eletrônicos, Alateen, Comitê, etc.) ==========
    function abrirPorTipoGrupo(tipo, titulo) {
        if (!todosLocais) {
            carregarDados().then(() => {
                abrirPorTipoGrupo(tipo, titulo);
            }).catch(err => {
                alert('Erro ao carregar dados: ' + err.message);
            });
            return;
        }
        const filtrados = todosLocais.filter(local => local.grupo_tipo === tipo);
        if (filtrados.length === 0) {
            alert(`Nenhum grupo encontrado com tipo = "${tipo}".`);
            return;
        }
        modoTipoAtivo = true;
        tipoFiltro = tipo;
        ufAtiva = null;
        tituloEl.textContent = titulo;
        bandeiraEl.src = '';
        bandeiraEl.style.display = 'none';
        esconderFiltros();
        esconderBotaoVoltar();
        locaisDoEstado = filtrados;
        filtroAtivo = 'todos';
        listaEl.classList.remove('cidades-grid');
        renderizarPorTipo();
        abrirPainel();
    }

    function renderizarPorTipo() {
        listaEl.classList.remove('cidades-grid');
        const busca = buscaEl.value.trim().toLowerCase();
        let filtrados = locaisDoEstado;
        if (busca) {
            filtrados = filtrados.filter(local => {
                const haystack = [nomeGrupo(local), local.gr_local, local.gr_cidade, local.gr_bairro, local.gr_endereco].join(' ').toLowerCase();
                return haystack.includes(busca);
            });
        }
        contadorEl.textContent = filtrados.length === 0
            ? 'Nenhum local encontrado.'
            : `${filtrados.length} local${filtrados.length > 1 ? 's' : ''} encontrado${filtrados.length > 1 ? 's' : ''}.`;
        if (filtrados.length === 0) {
            listaEl.innerHTML = `<div class="estado-msg"><div class="icone">🔍</div><p>Nenhum grupo do tipo "${tipoFiltro}"<br>${busca ? 'para a busca "' + esc(busca) + '"' : ''}</p></div>`;
            return;
        }
        listaEl.innerHTML = filtrados.map((local, idx) => {
            let badge = '';
            if (local.grupo_tipo === 'Al-Anon') badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            else if (local.grupo_tipo === 'Alateen') badge = '<span class="grupo-badge badge-alateen">Alateen</span>';
            else if (local.grupo_tipo === 'Eletrônico') badge = '<span class="grupo-badge badge-eletronico">Eletrônico</span>';
            else if (local.grupo_tipo === 'Comitê') badge = '<span class="grupo-badge badge-comite">Comitê</span>';
            else badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            const endereco = [local.gr_endereco, local.gr_numero, local.gr_bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.gr_cidade, local.gr_uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-tipo-idx="${idx}">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.gr_local ? `<span><span class="rotulo">Local:</span> ${esc(local.gr_local)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                        ${local.gr_telefone ? `<span><span class="rotulo">Telefone:</span> ${esc(local.gr_telefone)}</span>` : ''}
                        ${local.gr_celular ? `<span><span class="rotulo">Celular:</span> ${esc(local.gr_celular)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');
        document.querySelectorAll('.grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.tipoIdx);
            const handler = () => { abrirModalLocal(filtrados[idx]); };
            card.addEventListener('click', handler);
        });
    }

    fecharPainel = function () {
        if (modoTipoAtivo) {
            modoTipoAtivo = false;
            tipoFiltro = null;
            ufAtiva = null;
            mostrarFiltros();
            bandeiraEl.style.display = '';
            tituloEl.textContent = 'Grupos';
            listaEl.innerHTML = '';
            contadorEl.textContent = '';
            buscaEl.value = '';
        }
        fecharPainelOriginal();
    };

    // ========== MAPA GERAL ==========
    async function abrirMapaGeral() {
        modalMapaGeral.classList.add('visivel');
        if (mapaGeral) {
            setTimeout(() => mapaGeral.invalidateSize(), 100);
            return;
        }
        mapaGeral = L.map('mapa-geral').setView([-15.78, -47.93], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapaGeral);
        clusterGroup = L.markerClusterGroup();
        mapaGeral.addLayer(clusterGroup);

        try {
            const dados = await carregarDados();
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading-message';
            loadingDiv.innerText = 'Carregando locais... (pode demorar na primeira vez)';
            document.getElementById('mapa-geral').appendChild(loadingDiv);

            const locaisComCoords = [];
            for (const local of dados) {
                let coords = null;
                if (local.mapa_latitude && local.mapa_longitude) {
                    coords = { lat: parseFloat(local.mapa_latitude), lng: parseFloat(local.mapa_longitude) };
                } else {
                    const cached = getCachedCoords(local);
                    if (cached) {
                        coords = cached;
                    } else {
                        const endereco = [local.gr_endereco, local.gr_numero, local.gr_bairro, local.gr_cidade, local.gr_uf, 'Brasil'].filter(Boolean).join(', ');
                        coords = await geocodificarEndereco(endereco);
                        if (coords) setCachedCoords(local, coords);
                    }
                }
                locaisComCoords.push({ local, coords });
            }
            loadingDiv.remove();

            for (const { local, coords } of locaisComCoords) {
                const nome = nomeGrupo(local);
                const cidade = local.gr_cidade || '';
                const uf = local.gr_uf || '';
                const endereco = [local.gr_endereco, local.gr_numero, local.gr_bairro].filter(Boolean).join(', ');
                const popupContent = `
                    <strong>${esc(nome)}</strong><br>
                    ${local.gr_local ? `<em>${esc(local.gr_local)}</em><br>` : ''}
                    ${endereco ? esc(endereco) + '<br>' : ''}
                    ${cidade} ${uf}<br>
                    <button class="ver-detalhes-mapa" style="margin-top:5px;padding:4px 8px;background:#1a6bbf;color:#fff;border:none;border-radius:4px;cursor:pointer;">Ver detalhes</button>
                `;
                const marker = L.marker(coords ? [coords.lat, coords.lng] : [-15.78, -47.93])
                    .bindPopup(popupContent);
                marker.on('popupopen', () => {
                    setTimeout(() => {
                        const btn = document.querySelector('.ver-detalhes-mapa');
                        if (btn) {
                            btn.onclick = (e) => {
                                e.stopPropagation();
                                fecharMapaGeral();
                                abrirModalLocal(local);
                            };
                        }
                    }, 50);
                });
                clusterGroup.addLayer(marker);
            }
        } catch (err) {
            console.error(err);
            alert('Erro ao carregar locais. Tente novamente.');
            const loadingDiv = document.querySelector('.loading-message');
            if (loadingDiv) loadingDiv.remove();
            fecharMapaGeral();
        }
    }

    function fecharMapaGeral() {
        modalMapaGeral.classList.remove('visivel');
    }
    btnMapaGeral.addEventListener('click', e => { e.preventDefault(); abrirMapaGeral(); });
    btnFecharMapaGeral.addEventListener('click', fecharMapaGeral);
    modalMapaGeral.addEventListener('click', e => { if (e.target === modalMapaGeral) fecharMapaGeral(); });

    // ========== PESQUISA ==========
    async function abrirPesquisa() {
        modalPesquisa.classList.add('visivel');
        if (!todosLocais) {
            await carregarDados();
        }
        pesquisaInput.value = '';
        pesquisaResultados.innerHTML = `<div class="estado-msg"><div class="icone">🔎</div><p>Digite o nome do local ou cidade para iniciar a busca.</p></div>`;
        pesquisaInput.focus();
    }
    function fecharPesquisa() {
        modalPesquisa.classList.remove('visivel');
    }
    btnPesquisa.addEventListener('click', (e) => { e.preventDefault(); abrirPesquisa(); });
    btnFecharPesquisa.addEventListener('click', fecharPesquisa);
    modalPesquisa.addEventListener('click', (e) => { if (e.target === modalPesquisa) fecharPesquisa(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalPesquisa.classList.contains('visivel')) fecharPesquisa(); });

    function atualizarResultadosPesquisa() {
        const termo = pesquisaInput.value.trim().toLowerCase();
        if (!termo) {
            pesquisaResultados.innerHTML = `<div class="estado-msg"><div class="icone">🔎</div><p>Digite o nome do local ou cidade para iniciar a busca.</p></div>`;
            return;
        }
        if (!todosLocais) return;
        const resultados = todosLocais.filter(local => {
            const nome = nomeGrupo(local).toLowerCase();
            const localFuncionamento = (local.gr_local || '').toLowerCase();
            const cidade = (local.gr_cidade || '').toLowerCase();
            return nome.includes(termo) || localFuncionamento.includes(termo) || cidade.includes(termo);
        });
        if (resultados.length === 0) {
            pesquisaResultados.innerHTML = `<div class="estado-msg"><div class="icone">😔</div><p>Nenhum local encontrado com "${esc(termo)}".</p></div>`;
            return;
        }
        pesquisaResultados.innerHTML = resultados.map((local, idx) => {
            let badge = '';
            if (local.grupo_tipo === 'Al-Anon') badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            else if (local.grupo_tipo === 'Alateen') badge = '<span class="grupo-badge badge-alateen">Alateen</span>';
            else if (local.grupo_tipo === 'Eletrônico') badge = '<span class="grupo-badge badge-eletronico">Eletrônico</span>';
            else if (local.grupo_tipo === 'Comitê') badge = '<span class="grupo-badge badge-comite">Comitê</span>';
            else badge = '<span class="grupo-badge badge-alanon">Al-Anon</span>';
            const endereco = [local.gr_endereco, local.gr_numero, local.gr_bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.gr_cidade, local.gr_uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-pesquisa-idx="${idx}">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.gr_local ? `<span><span class="rotulo">Local:</span> ${esc(local.gr_local)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                        ${local.gr_telefone ? `<span><span class="rotulo">Telefone:</span> ${esc(local.gr_telefone)}</span>` : ''}
                        ${local.gr_celular ? `<span><span class="rotulo">Celular:</span> ${esc(local.gr_celular)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');
        document.querySelectorAll('#modal-pesquisa .grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.pesquisaIdx);
            const handler = () => {
                fecharPesquisa();
                abrirModalLocal(resultados[idx]);
            };
            card.addEventListener('click', handler);
        });
    }
    let pesquisaDebounce;
    pesquisaInput.addEventListener('input', () => {
        clearTimeout(pesquisaDebounce);
        pesquisaDebounce = setTimeout(atualizarResultadosPesquisa, 220);
    });

    // ========== ESTADOS ==========
    const estados = [
        { uf: "AC", nome: "Acre", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ac.png" },
        { uf: "AL", nome: "Alagoas", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/al.png" },
        { uf: "AP", nome: "Amapá", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ap.png" },
        { uf: "AM", nome: "Amazonas", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/am.png" },
        { uf: "BA", nome: "Bahia", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ba.png" },
        { uf: "CE", nome: "Ceará", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ce.png" },
        { uf: "DF", nome: "Distrito Federal", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/df.png" },
        { uf: "ES", nome: "Espírito Santo", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/es.png" },
        { uf: "GO", nome: "Goiás", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/go.png" },
        { uf: "MA", nome: "Maranhão", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ma.png" },
        { uf: "MT", nome: "Mato Grosso", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/mt.png" },
        { uf: "MS", nome: "Mato Grosso do Sul", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ms.png" },
        { uf: "MG", nome: "Minas Gerais", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/mg.png" },
        { uf: "PA", nome: "Pará", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/pa.png" },
        { uf: "PB", nome: "Paraíba", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/pb.png" },
        { uf: "PR", nome: "Paraná", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/pr.png" },
        { uf: "PE", nome: "Pernambuco", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/pe.png" },
        { uf: "PI", nome: "Piauí", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/pi.png" },
        { uf: "RJ", nome: "Rio de Janeiro", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/rj.png" },
        { uf: "RN", nome: "Rio Grande do Norte", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/rn.png" },
        { uf: "RS", nome: "Rio Grande do Sul", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/rs.png" },
        { uf: "RO", nome: "Rondônia", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/ro.png" },
        { uf: "RR", nome: "Roraima", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/rr.png" },
        { uf: "SC", nome: "Santa Catarina", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/sc.png" },
        { uf: "SP", nome: "São Paulo", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/sp.png" },
        { uf: "SE", nome: "Sergipe", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/se.png" },
        { uf: "TO", nome: "Tocantins", img: "https://atlasescolar.ibge.gov.br/images/bandeiras/ufs/to.png" }
    ];

    const estadosGrid = document.getElementById('estados-grid');
    estados.forEach(e => {
        const div = document.createElement('div');
        div.className = 'estado';
        div.dataset.uf = e.uf;
        div.dataset.nome = e.nome;
        div.innerHTML = `<img src="${e.img}" alt="${e.nome}"><span>${e.nome}</span>`;
        estadosGrid.appendChild(div);
    });

    // ========== CLIQUE NO ESTADO ==========
    document.querySelectorAll('.estado').forEach(el => {
        el.addEventListener('click', async () => {
            const uf = el.dataset.uf;
            const nome = el.dataset.nome;
            const imgSrc = el.querySelector('img').src;

            document.querySelectorAll('.estado.ativo').forEach(e => e.classList.remove('ativo'));
            el.classList.add('ativo');

            ufAtiva = uf;
            nomeEstadoAtivo = nome;
            modoCidades = true;
            cidadeSelecionada = null;
            nomeCidadeSelecionada = null;
            modoTipoAtivo = false;

            tituloEl.textContent = `Cidades em ${nome}`;
            bandeiraEl.src = imgSrc;
            bandeiraEl.style.display = '';

            esconderFiltros();
            esconderBotaoVoltar();
            buscaEl.value = '';
            buscaEl.placeholder = 'Buscar cidade…';

            listaEl.innerHTML = `<div class="estado-msg"><div class="spinner"></div><p>Carregando cidades...</p></div>`;
            contadorEl.textContent = '';

            abrirPainel();

            try {
                const dados = await carregarDados();
                locaisDoEstado = dados.filter(local => (local.gr_uf || '').toUpperCase() === uf.toUpperCase());

                if (locaisDoEstado.length === 0) {
                    listaEl.innerHTML = `<div class="estado-msg"><div class="icone">😔</div><p>Nenhum grupo cadastrado<br>em <strong>${nome}</strong> ainda.</p></div>`;
                    contadorEl.textContent = '0 cidades encontradas.';
                } else {
                    renderizarCidades();
                }
            } catch (err) {
                listaEl.innerHTML = `<div class="estado-msg"><div class="icone">⚠️</div><p>Erro ao carregar os dados.<br><small>${err.message}</small></p></div>`;
                contadorEl.textContent = '';
            }
        });
    });

    // ========== FILTROS ==========
    if (filtrosBtns.length > 0) {
        filtrosBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const filtroValor = btn.dataset.filtro;
                if (filtroValor === 'todos') filtroAtivo = 'todos';
                else if (filtroValor === 'alanon') filtroAtivo = 'Al-Anon';
                else if (filtroValor === 'alateen') filtroAtivo = 'Alateen';
                else if (filtroValor === 'eletronico') filtroAtivo = 'Eletrônico';
                filtrosBtns.forEach(b => b.classList.toggle('ativo', b === btn));
                if (modoTipoAtivo) renderizarPorTipo();
                else renderizar();
            });
        });
    }

    // ========== BUSCA ==========
    let debounceTimer;
    buscaEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (modoTipoAtivo) renderizarPorTipo();
            else if (modoCidades) renderizarCidades();
            else renderizar();
        }, 220);
    });

    // ========== BOTÕES TIPO ==========
    const btnEletronicos = document.getElementById('btn-grupos-eletronicos');
    const btnAcolhimento = document.getElementById('btn-acolhimento');
    const btnAlateen = document.getElementById('btn-alateen');
    const btnAlAnon = document.getElementById('btn-al-anon');

    if (btnEletronicos) {
        btnEletronicos.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorTipoGrupo('Eletrônico', 'Grupos Eletrônicos');
        });
    }
    if (btnAcolhimento) {
        btnAcolhimento.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorTipoGrupo('Comitê', 'Grupos de Acolhimento');
        });
    }
    if (btnAlateen) {
        btnAlateen.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorTipoGrupo('Alateen', 'Grupos Alateen');
        });
    }
    if (btnAlAnon) {
        btnAlAnon.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorTipoGrupo('Al-Anon', 'Grupos Al-Anon');
        });
    }
})();
