(() => {
    // ========== CONFIGURAÇÃO ==========
    const API_URL = 'https://al-anon.org.br/api/enderecos.php';
    const LOCATIONIQ_KEY = 'pk.e0313d2db1366ca073ba2189fc75d981'; // Substitua se necessário
    const CACHE_KEY = 'alanon_enderecos_coords';
    const CACHE_VERSION = 'v2';

    let todosLocais = null;         // array de objetos retornados pela API
    let locaisDoEstado = [];
    let filtroAtivo = 'todos';      // 'todos', 'alanon', 'alateen', 'eletronico'
    let ufAtiva = null;
    let mapaLeaflet = null;
    let mapaMarker = null;

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

    // ========== NOVAS VARIÁVEIS PARA MODO SITUAÇÃO ==========
    let modoSituacaoAtivo = false;
    let situacaoFiltro = null;

    // ========== FUNÇÕES AUXILIARES ==========
    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function nomeGrupo(local) {
        return local.nome || 'Grupo sem nome';
    }

    // ========== GEOCODIFICAÇÃO (LocationIQ) ==========
    async function geocodificarLocationIQ(query) {
        const url = `https://us1.locationiq.com/v1/search.php?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br&accept-language=pt-BR`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const data = await resp.json();
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                console.log('✅ LocationIQ encontrou:', { lat, lon });
                return { lat, lng: lon };
            }
        } catch (e) {
            console.warn('Erro no LocationIQ:', e);
        }
        return null;
    }

    async function geocodificarEndereco(endereco) {
        if (!endereco || endereco.trim() === '') return null;
        console.log('🔍 Geocodificando:', endereco);
        const coords = await geocodificarLocationIQ(endereco);
        if (coords) return coords;
        const cidadeUf = endereco.split(',').slice(-2).join(',').trim();
        if (cidadeUf !== endereco) {
            console.log('🔄 Fallback cidade/UF:', cidadeUf);
            return await geocodificarLocationIQ(cidadeUf);
        }
        return null;
    }

    // ========== CACHE DE COORDENADAS ==========
    function getCachedCoords(local) {
        try {
            const cache = localStorage.getItem(CACHE_KEY);
            if (!cache) return null;
            const data = JSON.parse(cache);
            if (data.version !== CACHE_VERSION) return null;
            const key = local.id_endereco ? `id_${local.id_endereco}` : local.local_funcionamento.replace(/\s/g, '_');
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
            const key = local.id_endereco ? `id_${local.id_endereco}` : local.local_funcionamento.replace(/\s/g, '_');
            data.coords[key] = {
                coords: coords,
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (e) { }
    }

    function montarEnderecoCompleto(local) {
        const partes = [];
        if (local.logradouro) partes.push(local.logradouro);
        if (local.numero) partes.push(local.numero);
        if (local.complemento) partes.push(local.complemento);
        if (local.bairro) partes.push(local.bairro);
        if (local.cidade) partes.push(local.cidade);
        if (local.uf) partes.push(local.uf);
        if (local.cep) partes.push(local.cep);
        partes.push('Brasil');
        return partes.join(', ');
    }

    // ========== PAINEL LATERAL (original) ==========
    function abrirPainel() {
        overlay.style.display = 'block';
        painel.classList.add('aberto');
        document.body.style.overflow = 'hidden';
        buscaEl.focus();
    }

    // Será sobrescrita para tratar o fechamento no modo situação
    function fecharPainelOriginal() {
        painel.classList.remove('aberto');
        overlay.style.display = 'none';
        document.body.style.overflow = '';
        document.querySelectorAll('.estado.ativo').forEach(e => e.classList.remove('ativo'));
        ufAtiva = null;
    }

    let fecharPainel = fecharPainelOriginal;

    btnFechar.addEventListener('click', () => fecharPainel());
    overlay.addEventListener('click', () => fecharPainel());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal() || fecharPainel(); });

    // ========== MODAL DE DETALHES ==========
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
        const badge = `<span class="grupo-badge badge-alanon">Al-Anon</span>`;
        modalTitulo.textContent = nome;
        modalBadge.innerHTML = badge;
        modalCidadeUF.textContent = [local.cidade, local.uf].filter(Boolean).join(' - ');

        const endereco = montarEnderecoCompleto(local);
        const endNav = encodeURIComponent(endereco || nome + ' Brasil');

        // Montar informações (parte esquerda)
        let infoHTML = '';
        if (local.local_funcionamento) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">Local da Reunião</div>`;
            infoHTML += linha('🏛️', local.local_funcionamento);
            infoHTML += `</div>`;
        }
        if (local.reuniao) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">🗓️ Reuniões</div>`;
            infoHTML += linha('⏰', local.reuniao);
            infoHTML += `</div>`;
        }
        if (local.reuniao_obs && local.reuniao_obs.trim()) {
            infoHTML += linha('📝', local.reuniao_obs);
        }
        if (local.logradouro || local.numero || local.bairro) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">Endereço</div>`;
            if (local.logradouro) infoHTML += linha('🏠', `${local.logradouro}${local.numero ? ', ' + local.numero : ''}`);
            if (local.bairro) infoHTML += linha('🏘️', local.bairro);
            if (local.cidade && local.uf) infoHTML += linha('🌆', `${local.cidade} - ${local.uf}`);
            if (local.cep) infoHTML += linha('📮', local.cep);
            infoHTML += `</div>`;
        }
        if (local.ponto_referencia) {
            infoHTML += `<div class="modal-secao"><div class="modal-secao-titulo">Ponto de referência</div>`;
            infoHTML += linha('📍', local.ponto_referencia);
            infoHTML += `</div>`;
        }
        modalInfos.innerHTML = infoHTML;

        // Verifica se é grupo online (situação contém "eletrônico" ou "online")
        const isOnline = local.situacao && (
            local.situacao.toLowerCase().includes('eletrônico') ||
            local.situacao.toLowerCase().includes('online') ||
            local.situacao.toLowerCase().includes('acolhimento')
        );

        // Elementos do modal (CORRIGIDO: usar classe, não id)
        const modalMapaWrap = document.querySelector('.modal-mapa-wrap');
        const modalMapaDiv = document.getElementById('modal-mapa');
        const modalMapaAcoes = document.getElementById('modal-mapa-acoes');

        if (isOnline) {
            // --- GRUPO ONLINE ---
            // Esconde o mapa
            if (modalMapaDiv) modalMapaDiv.style.display = 'none';
            if (modalMapaAcoes) modalMapaAcoes.innerHTML = '';

            // Cria bloco de informações online dentro do .modal-mapa-wrap
            let onlineInfoDiv = document.getElementById('online-info-block');
            if (!onlineInfoDiv && modalMapaWrap) {
                onlineInfoDiv = document.createElement('div');
                onlineInfoDiv.id = 'online-info-block';
                onlineInfoDiv.className = 'online-info-block';
                modalMapaWrap.appendChild(onlineInfoDiv);
            }

            if (onlineInfoDiv) {
                let onlineHtml = `<div class="modal-secao"><div class="modal-secao-titulo">🌐 Reunião Online</div>`;
                // if (local.reuniao_obs) {
                //     onlineHtml += `<div class="modal-linha"><span class="icone-linha">📋</span><span>${esc(local.reuniao_obs)}</span></div>`;
                // }
                if (local.reuniao_url && local.reuniao_url.trim() !== '') {
                    onlineHtml += `<div class="modal-linha"><span class="icone-linha">🔗</span><a href="${esc(local.reuniao_url)}" target="_blank" rel="noopener">Acessar reunião online</a></div>`;
                } else {
                    onlineHtml += `<div class="modal-linha"><span class="icone-linha">⚠️</span><span>URL de acesso não informada.</span></div>`;
                }
                onlineHtml += `</div>`;
                onlineInfoDiv.innerHTML = onlineHtml;
                onlineInfoDiv.style.display = 'block';
            }

            // Botão de acesso na área de ações (opcional)
            // if (modalMapaAcoes && local.reuniao_url && local.reuniao_url.trim() !== '') {
            //     modalMapaAcoes.innerHTML = `<a class="btn-mapa-acao google" href="${esc(local.reuniao_url)}" target="_blank" rel="noopener">🎥 Entrar na Reunião Online</a>`;
            // } else if (modalMapaAcoes) {
            //     modalMapaAcoes.innerHTML = `<span style="padding:6px 12px; color:#666;">Link não disponível</span>`;
            // }

            // Remove marcador do mapa, se existir
            if (mapaMarker && mapaLeaflet) mapaLeaflet.removeLayer(mapaMarker);

            abrirModal();
            setTimeout(() => {
                if (mapaLeaflet) mapaLeaflet.invalidateSize();
            }, 120);
            return;
        }

        // --- GRUPO PRESENCIAL ---
        // Garante que o mapa seja exibido e o bloco online seja removido
        if (modalMapaDiv) modalMapaDiv.style.display = 'block';
        const onlineBlock = document.getElementById('online-info-block');
        if (onlineBlock) onlineBlock.style.display = 'none';

        // Botões de navegação
        if (modalMapaAcoes) {
            modalMapaAcoes.innerHTML = `
            <a class="btn-mapa-acao google" href="https://www.google.com/maps/search/?api=1&query=${endNav}" target="_blank" rel="noopener">🗺️ Google Maps</a>
            <a class="btn-mapa-acao waze" href="https://waze.com/ul?q=${endNav}" target="_blank" rel="noopener">🔵 Waze</a>
        `;
        }

        abrirModal();
        inicializarMapaSeNecessario();
        setTimeout(() => mapaLeaflet.invalidateSize(), 120);

        // Busca coordenadas
        let coords = null;
        if (local.mapa_latitude && local.mapa_longitude) {
            coords = { lat: parseFloat(local.mapa_latitude), lng: parseFloat(local.mapa_longitude) };
        } else {
            const cached = getCachedCoords(local);
            if (cached) {
                coords = cached;
            } else {
                const enderecoGeo = [local.logradouro, local.numero, local.bairro, local.cidade, local.uf, 'Brasil'].filter(Boolean).join(', ');
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
        todosLocais = json.data;
        return todosLocais;
    }

    function tipoGrupo(local) {
        return 'alanon';
    }

    function badgeGrupo(tipo) {
        return `<span class="grupo-badge badge-alanon">Al-Anon</span>`;
    }

    // ========== RENDERIZAÇÃO ORIGINAL (por estado) ==========
    function renderizar() {
        const busca = buscaEl.value.trim().toLowerCase();
        const filtrados = locaisDoEstado.filter(local => {
            if (filtroAtivo !== 'todos' && tipoGrupo(local) !== filtroAtivo) return false;
            if (busca) {
                const haystack = [nomeGrupo(local), local.local_funcionamento, local.cidade, local.bairro, local.logradouro].join(' ').toLowerCase();
                if (!haystack.includes(busca)) return false;
            }
            return true;
        });
        contadorEl.textContent = filtrados.length === 0 ? 'Nenhum local encontrado.' : `${filtrados.length} local${filtrados.length > 1 ? 's' : ''} encontrado${filtrados.length > 1 ? 's' : ''}.`;
        if (filtrados.length === 0) {
            listaEl.innerHTML = `<div class="estado-msg"><div class="icone">🔍</div><p>Nenhum local encontrado<br>com esses filtros.</p></div>`;
            return;
        }
        listaEl.innerHTML = filtrados.map((local, idx) => {
            const badge = badgeGrupo('alanon');
            const endereco = [local.logradouro, local.numero, local.bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.cidade, local.uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-idx="${idx}" tabindex="0" role="button">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.local_funcionamento ? `<span><span class="rotulo">Local:</span> ${esc(local.local_funcionamento)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');
        listaEl.querySelectorAll('.grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.idx);
            const handler = () => {
                const busca2 = buscaEl.value.trim().toLowerCase();
                const filtrados2 = locaisDoEstado.filter(local => {
                    if (filtroAtivo !== 'todos' && tipoGrupo(local) !== filtroAtivo) return false;
                    if (busca2) {
                        const haystack = [nomeGrupo(local), local.local_funcionamento, local.cidade, local.bairro, local.logradouro].join(' ').toLowerCase();
                        if (!haystack.includes(busca2)) return false;
                    }
                    return true;
                });
                if (filtrados2[idx]) abrirModalLocal(filtrados2[idx]);
            };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
        });
    }

    // ========== NOVAS FUNÇÕES PARA EXIBIR POR SITUAÇÃO ==========
    function abrirPorSituacao(situacao, titulo) {
        if (!todosLocais) {
            carregarDados().then(() => {
                abrirPorSituacao(situacao, titulo);
            }).catch(err => {
                alert('Erro ao carregar dados: ' + err.message);
            });
            return;
        }

        const filtrados = todosLocais.filter(local => local.situacao === situacao);
        if (filtrados.length === 0) {
            alert(`Nenhum grupo encontrado com situação = "${situacao}".`);
            return;
        }

        modoSituacaoAtivo = true;
        situacaoFiltro = situacao;
        ufAtiva = null;

        tituloEl.textContent = titulo;
        bandeiraEl.src = '';
        bandeiraEl.style.display = 'none';

        // Oculta os filtros de tipo (Al-Anon/Alateen) e mantém a busca
        const painelFiltros = document.querySelector('.painel-filtros');
        if (painelFiltros) painelFiltros.style.display = 'none';

        locaisDoEstado = filtrados;
        filtroAtivo = 'todos';
        renderizarPorSituacao();

        abrirPainel();
    }

    function renderizarPorSituacao() {
        const busca = buscaEl.value.trim().toLowerCase();
        let filtrados = locaisDoEstado;
        if (busca) {
            filtrados = filtrados.filter(local => {
                const haystack = [nomeGrupo(local), local.local_funcionamento, local.cidade, local.bairro, local.logradouro].join(' ').toLowerCase();
                return haystack.includes(busca);
            });
        }
        contadorEl.textContent = filtrados.length === 0 ? 'Nenhum local encontrado.' : `${filtrados.length} local${filtrados.length > 1 ? 's' : ''} encontrado${filtrados.length > 1 ? 's' : ''}.`;
        if (filtrados.length === 0) {
            listaEl.innerHTML = `<div class="estado-msg"><div class="icone">🔍</div><p>Nenhum grupo com situação "${situacaoFiltro}"<br>${busca ? 'para a busca "' + esc(busca) + '"' : ''}</p></div>`;
            return;
        }
        listaEl.innerHTML = filtrados.map((local, idx) => {
            const badge = badgeGrupo('alanon');
            const endereco = [local.logradouro, local.numero, local.bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.cidade, local.uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-situacao-idx="${idx}" tabindex="0" role="button">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.local_funcionamento ? `<span><span class="rotulo">Local:</span> ${esc(local.local_funcionamento)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');
        listaEl.querySelectorAll('.grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.situacaoIdx);
            const handler = () => {
                abrirModalLocal(filtrados[idx]);
            };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
        });
    }

    // Sobrescreve a função fecharPainel para restaurar o modo normal
    fecharPainel = function () {
        if (modoSituacaoAtivo) {
            modoSituacaoAtivo = false;
            situacaoFiltro = null;
            ufAtiva = null;
            const painelFiltros = document.querySelector('.painel-filtros');
            if (painelFiltros) painelFiltros.style.display = 'flex';
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
                        const endereco = [local.logradouro, local.numero, local.bairro, local.cidade, local.uf, 'Brasil'].filter(Boolean).join(', ');
                        coords = await geocodificarEndereco(endereco);
                        if (coords) setCachedCoords(local, coords);
                    }
                }
                locaisComCoords.push({ local, coords });
            }
            loadingDiv.remove();

            for (const { local, coords } of locaisComCoords) {
                const nome = nomeGrupo(local);
                const cidade = local.cidade || '';
                const uf = local.uf || '';
                const endereco = [local.logradouro, local.numero, local.bairro].filter(Boolean).join(', ');
                const popupContent = `
                    <strong>${esc(nome)}</strong><br>
                    ${local.local_funcionamento ? `<em>${esc(local.local_funcionamento)}</em><br>` : ''}
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
            const localFuncionamento = (local.local_funcionamento || '').toLowerCase();
            const cidade = (local.cidade || '').toLowerCase();
            return nome.includes(termo) || localFuncionamento.includes(termo) || cidade.includes(termo);
        });
        if (resultados.length === 0) {
            pesquisaResultados.innerHTML = `<div class="estado-msg"><div class="icone">😔</div><p>Nenhum local encontrado com "${esc(termo)}".</p></div>`;
            return;
        }
        pesquisaResultados.innerHTML = resultados.map((local, idx) => {
            const badge = badgeGrupo('alanon');
            const endereco = [local.logradouro, local.numero, local.bairro].filter(Boolean).join(', ');
            const cidadeUF = [local.cidade, local.uf].filter(Boolean).join(' - ');
            return `
                <div class="grupo-card" data-pesquisa-idx="${idx}">
                    <div class="grupo-card-topo">
                        <div class="grupo-nome">${esc(nomeGrupo(local))}</div>
                        ${badge}
                    </div>
                    <div class="grupo-info">
                        ${local.local_funcionamento ? `<span><span class="rotulo">Local:</span> ${esc(local.local_funcionamento)}</span>` : ''}
                        ${endereco ? `<span><span class="rotulo">Endereço:</span> ${esc(endereco)}</span>` : ''}
                        ${cidadeUF ? `<span><span class="rotulo">Cidade:</span> ${esc(cidadeUF)}</span>` : ''}
                    </div>
                    <div class="hint-clique">🔍 Clique para ver detalhes e localização</div>
                </div>`;
        }).join('');
        pesquisaResultados.querySelectorAll('.grupo-card').forEach(card => {
            const idx = parseInt(card.dataset.pesquisaIdx);
            const handler = () => {
                fecharPesquisa();
                abrirModalLocal(resultados[idx]);
            };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handler();
                }
            });
        });
    }
    let pesquisaDebounce;
    pesquisaInput.addEventListener('input', () => {
        clearTimeout(pesquisaDebounce);
        pesquisaDebounce = setTimeout(atualizarResultadosPesquisa, 220);
    });

    // ========== LISTA DE ESTADOS ==========
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

    document.querySelectorAll('.estado').forEach(el => {
        el.addEventListener('click', async () => {
            const uf = el.dataset.uf;
            const nome = el.dataset.nome;
            const imgSrc = el.querySelector('img').src;
            document.querySelectorAll('.estado.ativo').forEach(e => e.classList.remove('ativo'));
            el.classList.add('ativo');
            tituloEl.textContent = `Locais em ${nome}`;
            bandeiraEl.src = imgSrc;
            filtroAtivo = 'todos';
            filtrosBtns.forEach(b => b.classList.toggle('ativo', b.dataset.filtro === 'todos'));
            buscaEl.value = '';
            listaEl.innerHTML = `<div class="estado-msg"><div class="spinner"></div><p>Carregando locais...</p></div>`;
            contadorEl.textContent = '';
            abrirPainel();
            try {
                const dados = await carregarDados();
                locaisDoEstado = dados.filter(local => (local.uf || '').toUpperCase() === uf.toUpperCase());
                ufAtiva = uf;
                if (locaisDoEstado.length === 0) {
                    listaEl.innerHTML = `<div class="estado-msg"><div class="icone">😔</div><p>Nenhum local cadastrado<br>em <strong>${nome}</strong> ainda.</p></div>`;
                    contadorEl.textContent = '0 locais encontrados.';
                } else {
                    renderizar();
                }
            } catch (err) {
                listaEl.innerHTML = `<div class="estado-msg"><div class="icone">⚠️</div><p>Erro ao carregar os dados.<br><small>${err.message}</small></p></div>`;
                contadorEl.textContent = '';
            }
        });
    });

    // Filtros
    filtrosBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filtroAtivo = btn.dataset.filtro;
            filtrosBtns.forEach(b => b.classList.toggle('ativo', b === btn));
            renderizar();
        });
    });

    // Listener da busca no painel (funciona tanto para modo estado quanto modo situação)
    let debounceTimer;
    buscaEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (modoSituacaoAtivo) {
                renderizarPorSituacao();
            } else {
                renderizar();
            }
        }, 220);
    });

    // ========== EVENTOS DOS BOTÕES DE SITUAÇÃO ==========
    const btnEletronicos = document.getElementById('btn-grupos-eletronicos');
    const btnAcolhimento = document.getElementById('btn-acolhimento');

    if (btnEletronicos) {
        btnEletronicos.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorSituacao('Grupo Eletrônico');
        });
    } else {
        console.warn('Elemento #btn-grupos-eletronicos não encontrado. Adicione o ID ao botão.');
    }

    if (btnAcolhimento) {
        btnAcolhimento.addEventListener('click', (e) => {
            e.preventDefault();
            abrirPorSituacao('Sala de Acolhimento');
        });
    } else {
        console.warn('Elemento #btn-acolhimento não encontrado. Adicione o ID ao botão.');
    }

    const hamburger = document.getElementById('hamburger');
    const navMenu = document.querySelector('.navbar .nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('aberto');
            navMenu.classList.toggle('aberto');
        });

        // Fechar menu ao clicar em um link
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('aberto');
                navMenu.classList.remove('aberto');
            });
        });
    }

    // Fechar menu se clicar fora
    document.addEventListener('click', (e) => {
        if (navMenu && navMenu.classList.contains('aberto') &&
            !navMenu.contains(e.target) &&
            !hamburger.contains(e.target)) {
            hamburger.classList.remove('aberto');
            navMenu.classList.remove('aberto');
        }
    });
})();