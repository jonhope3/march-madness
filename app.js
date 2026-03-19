// ============================================
// MARCH MADNESS 2026 — Material Design Blue App
// ============================================

(function () {
    'use strict';

    // --- Config ---
    const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
    const TOURNAMENT_DATES = [
        '20260319', '20260320',
        '20260321', '20260322', '20260323', '20260324',
        '20260325', '20260326', '20260327', '20260328',
        '20260329', '20260330', '20260406'
    ];
    const ROUND_LABELS = {
        '20260319': 'Round of 64', '20260320': 'Round of 64',
        '20260321': 'Round of 32', '20260322': 'Round of 32',
        '20260323': 'Sweet 16', '20260324': 'Sweet 16',
        '20260325': 'Sweet 16', '20260326': 'Sweet 16',
        '20260327': 'Elite 8', '20260328': 'Elite 8',
        '20260329': 'Final Four', '20260330': 'Final Four',
        '20260406': 'Championship'
    };
    const USER_TIMEZONE = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; }
        catch { return 'America/Chicago'; }
    })();

    function getTimezoneAbbr() {
        // Extract short timezone abbreviation like "CDT", "EST", "PST"
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: USER_TIMEZONE, timeZoneName: 'short' }).formatToParts(new Date());
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart ? tzPart.value : '';
    }

    const POLL_INTERVAL_LIVE = 15000;   // 15 seconds during live games
    const POLL_INTERVAL_IDLE = 120000;  // 2 minutes when no live games

    // --- State ---
    let currentDate = '20260319';
    let currentFilter = 'all'; // all, live, upcoming, completed
    let currentView = 'cards'; // cards, bracket, bets
    let currentBetTypeFilter = 'all'; // all, Sharp Money, Value Play, Coin-flip, etc'
    let allEvents = [];
    let isLoading = false;
    let pollTimer = null;
    let countdownTimer = null;
    let nextPollTime = 0;

    // --- DOM Refs ---
    const $ = id => document.getElementById(id);
    const loadingContainer = $('loading-container');
    const errorContainer = $('error-container');
    const noGamesContainer = $('no-games-container');
    const gamesContainer = $('games-container');
    const bracketContainer = $('bracket-container');
    const bracketContent = $('bracket-content');
    const betsContainer = $('bets-container');
    const datePills = $('date-pills');
    const modalOverlay = $('modal-overlay');
    const modalContent = $('modal-content');
    const modalTitle = $('modal-title');
    const lastUpdatedEl = $('last-updated');
    const liveBar = $('live-bar');
    const refreshCountdown = $('refresh-countdown');

    // --- Timezone Utilities ---
    function formatTimeLocal(isoStr) {
        if (!isoStr) return '';
        const date = new Date(isoStr);
        const tzAbbr = getTimezoneAbbr();
        const datePart = date.toLocaleDateString('en-US', { 
            month: 'short', day: 'numeric', timeZone: USER_TIMEZONE 
        });
        const timePart = date.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true,
            timeZone: USER_TIMEZONE
        });
        return `${datePart}, ${timePart}${tzAbbr ? ` ${tzAbbr}` : ''}`;
    }

    function getTodayStr() {
        const now = new Date();
        const localStr = now.toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
        return localStr.replace(/-/g, '');
    }

    function formatDate(dateStr) {
        const y = parseInt(dateStr.slice(0, 4));
        const m = parseInt(dateStr.slice(4, 6)) - 1;
        const d = parseInt(dateStr.slice(6, 8));
        const date = new Date(y, m, d);
        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function currentTimeLocal() {
        const tzAbbr = getTimezoneAbbr();
        return new Date().toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
            timeZone: USER_TIMEZONE
        }) + (tzAbbr ? ` ${tzAbbr}` : '');
    }

    function fallbackImg() {
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='60'%3E🏀%3C/text%3E%3C/svg%3E";
    }

    // --- Dark Mode ---
    function initTheme() {
        const saved = localStorage.getItem('mm-theme');
        document.documentElement.setAttribute('data-theme', saved || 'light');
        updateThemeIcon();

        $('theme-toggle').addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('mm-theme', next);
            updateThemeIcon();
        });
    }

    function updateThemeIcon() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        $('theme-icon').textContent = isDark ? 'light_mode' : 'dark_mode';
    }

    // --- Smart Polling (best approach for static/GitHub Pages) ---
    function startPolling() {
        stopPolling();
        const hasLive = allEvents.some(g => g.state === 'in');
        const interval = hasLive ? POLL_INTERVAL_LIVE : POLL_INTERVAL_IDLE;

        nextPollTime = Date.now() + interval;
        updateNextUpdateLabel();

        pollTimer = setTimeout(async () => {
            await loadData(true); // silent reload
            startPolling();       // reschedule
        }, interval);
    }

    function stopPolling() {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    }

    function updateNextUpdateLabel() {
        // Formats the future target time for the next data drop
        const target = new Date(nextPollTime).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
            timeZone: USER_TIMEZONE
        });
        const tz = getTimezoneAbbr();
        lastUpdatedEl.textContent = `Next update: ${target}${tz ? ` ${tz}` : ''}`;
    }

    // --- Fetch ---
    async function fetchGames(dateStr) {
        const url = `${ESPN_BASE}?dates=${dateStr}&limit=100&groups=100&_=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.events || [];
    }

    // --- Data Extraction ---
    function extractTeam(c) {
        const t = c.team || {};
        const rank = c.curatedRank?.current;
        const rec = (c.records || []).find(r => r.type === 'total');
        return {
            id: t.id,
            name: t.displayName || t.name || 'TBD',
            short: t.shortDisplayName || t.abbreviation || 'TBD',
            abbr: t.abbreviation || '',
            logo: t.logo || '',
            color: t.color ? `#${t.color}` : '#666',
            seed: (rank && rank <= 16) ? rank : null,
            score: c.score || '0',
            record: rec?.summary || '',
            homeAway: c.homeAway,
            isWinner: c.winner === true,
            leaders: (c.leaders || []).map(l => ({
                cat: l.shortDisplayName || l.abbreviation,
                player: l.leaders?.[0]?.athlete?.shortName || '',
                val: l.leaders?.[0]?.displayValue || '',
                photo: l.leaders?.[0]?.athlete?.headshot || ''
            }))
        };
    }
    // --- Caches ---
    const defaultOddsCache = (() => {
        try { 
            const stored = JSON.parse(localStorage.getItem('default-odds.json'));
            if (stored && Object.keys(stored).length > 10) return stored; // Only use if we have significant data
        } catch { }
        // Hardcoded deep fallback for today's active games to stop UI vanishing
        return {
            '401856479': { spread: 'OSU -2.5', overUnder: 'O/U 146.5', prediction: 'OSU -2.5', predReason: 'Favored by 2.5 pts' },
            '401856489': { spread: 'NEB -13.5', overUnder: 'O/U 137.5', prediction: 'NEB -13.5', predReason: 'Favored by 13.5 pts' },
            '401856482': { spread: 'LOU -3.5', overUnder: 'O/U 160.5', prediction: 'LOU -3.5', predReason: 'Favored by 3.5 pts' }
        };
    })();
    const adjustedOddsCache = (() => {
        try { return JSON.parse(localStorage.getItem('adjusted-odds.json')) || {}; }
        catch { return {}; }
    })();
    let suggestedBetsCache = (() => {
        try { return JSON.parse(localStorage.getItem('suggested-bets.json')) || []; }
        catch { return []; }
    })();

    function extractGame(ev, silent = true) {
        const comp = ev.competitions?.[0] || {};
        const competitors = comp.competitors || [];
        const homeC = competitors.find(c => c.homeAway === 'home') || competitors[0];
        const awayC = competitors.find(c => c.homeAway === 'away') || competitors[1];
        const venue = comp.venue || {};
        const st = (comp.status || ev.status || {});
        const sType = st.type || {};
        const odds = comp.odds?.[0] || {};
        const notes = comp.notes?.[0]?.headline || '';
        const bcNames = (comp.broadcasts || []).flatMap(b => b.names || []);
        const broadcast = comp.broadcast || bcNames.join(', ') || 'TBD';
        const home = homeC ? extractTeam(homeC) : null;
        const away = awayC ? extractTeam(awayC) : null;

        // 2. Adjusted Odds (Update if game hasn't started AND it's been > 15 mins OR explicitly on page refresh)
        if (sType.state === 'pre' && odds.details) {
            const now = Date.now();
            const lastUpdated = adjustedOddsCache[ev.id]?.lastUpdated || 0;
            if (!silent || now - lastUpdated > 15 * 60 * 1000) {
                adjustedOddsCache[ev.id] = {
                    spread: odds.details || '',
                    overUnder: odds.overUnder ? `O/U ${odds.overUnder}` : '',
                    mlHome: odds.moneyline?.home?.close?.odds || odds.moneyline?.home?.current?.odds || '',
                    mlAway: odds.moneyline?.away?.close?.odds || odds.moneyline?.away?.current?.odds || '',
                    lastUpdated: now
                };
                try { localStorage.setItem('adjusted-odds.json', JSON.stringify(adjustedOddsCache)); } catch(e){}
            }
        }

        // 1. Default odds (History from odds.json)
        const def = defaultOddsCache[ev.id] || {};
        const adj = adjustedOddsCache[ev.id] || {};

        // Display current odds if pre-game, otherwise lock to default odds (history) when live/finished
        // We safely fallback to adj if def is perfectly missing out of network failure so live games never lose their spread!
        const activeSpread = sType.state === 'pre' ? (adj.spread || def.spread || '') : (def.spread || adj.spread || '');
        const activeOU = sType.state === 'pre' ? (adj.overUnder || def.overUnder || '') : (def.overUnder || adj.overUnder || '');
        const activeMlHome = sType.state === 'pre' ? (adj.mlHome || def.mlHome || '') : (def.mlHome || adj.mlHome || '');
        const activeMlAway = sType.state === 'pre' ? (adj.mlAway || def.mlAway || '') : (def.mlAway || adj.mlAway || '');

        let region = '';
        const rMatch = notes.match(/(East|West|South|Midwest)/i);
        if (rMatch) region = rMatch[1];
        else if (notes.includes('Final Four')) region = 'Final Four';
        else if (notes.includes('Championship')) region = 'National';

        let round = '';
        if (notes.includes('1st Round')) round = '1st Round';
        else if (notes.includes('2nd Round')) round = '2nd Round';
        else if (notes.includes('Sweet 16')) round = 'Sweet 16';
        else if (notes.includes('Elite Eight')) round = 'Elite 8';
        else if (notes.includes('Final Four')) round = 'Final Four';
        else if (notes.includes('Championship')) round = 'Championship';

        // Auto-generate Projected Winner from active spread if missing in default database
        let prediction = def.prediction || '';
        let predReason = def.predReason || '';
        if (!prediction && activeSpread) {
            const m = activeSpread.match(/([a-zA-Z\s]+?)\s*(-[\d.]+)/);
            if (m) {
                const fav = (home?.abbr === m[1]) ? home : (away?.abbr === m[1]) ? away : null;
                if (fav) {
                    prediction = `${fav.short} ${m[2]}`;
                    predReason = `Favored by ${Math.abs(parseFloat(m[2]))} pts`;
                }
            }
        }

        return {
            id: ev.id, date: ev.date, name: ev.name,
            state: sType.state || 'pre',
            statusDetail: sType.state === 'pre' ? formatTimeLocal(ev.date) : (sType.detail || sType.shortDetail || ''),
            completed: sType.completed || false,
            clock: st.displayClock, period: st.period,
            city: venue.address ? `${venue.address.city}, ${venue.address.state}` : '',
            broadcast, region, round, notes,
            home, away,
            spread: activeSpread,
            overUnder: activeOU,
            mlHome: activeMlHome,
            mlAway: activeMlAway,
            prediction: prediction,
            predReason: predReason,
            espnLink: ev.links?.find(l => l.rel?.includes('summary'))?.href || ''
        };
    }    

    // --- Render: Date Pills ---
    function renderDatePills() {
        datePills.innerHTML = '';
        const today = getTodayStr();
        TOURNAMENT_DATES.forEach(d => {
            const btn = document.createElement('button');
            btn.className = `mdc-date-chip${d === currentDate ? ' mdc-date-chip--selected' : ''}`;
            const lbl = formatDate(d);
            const rnd = ROUND_LABELS[d] || '';
            btn.innerHTML = `${lbl}${rnd ? ` · <strong>${rnd}</strong>` : ''}`;
            if (d === today) btn.innerHTML += ' <span style="color:var(--accent-green);font-size:9px;">●</span>';
            btn.onclick = () => {
                currentDate = d;
                document.querySelectorAll('.mdc-date-chip').forEach(p => p.classList.remove('mdc-date-chip--selected'));
                btn.classList.add('mdc-date-chip--selected');
                loadData();
            };
            datePills.appendChild(btn);
        });
        const active = datePills.querySelector('.mdc-date-chip--selected');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // --- Render: Stats ---
    function renderStats() {
        const l = allEvents.filter(g => g.state === 'in').length;
        const c = allEvents.filter(g => g.state === 'post').length;
        const u = allEvents.filter(g => g.state === 'pre').length;
        document.querySelector('#stat-total-games .mdc-stat__value').textContent = allEvents.length;
        document.querySelector('#stat-live-games .mdc-stat__value').textContent = l;
        document.querySelector('#stat-completed .mdc-stat__value').textContent = c;
        document.querySelector('#stat-upcoming .mdc-stat__value').textContent = u;

        const ind = $('live-indicator');
        if (l > 0) {
            ind.style.background = 'var(--accent-live-light)';
            ind.style.borderColor = 'rgba(211,47,47,0.15)';
            ind.style.color = 'var(--accent-live)';
            ind.querySelector('.mdc-chip__dot').style.background = 'var(--accent-live)';
            ind.querySelector('.mdc-chip__label').textContent = `${l} Live`;
        } else {
            ind.style.background = 'var(--accent-blue-light)';
            ind.style.borderColor = 'rgba(21,101,192,0.15)';
            ind.style.color = 'var(--accent-blue)';
            ind.querySelector('.mdc-chip__dot').style.background = 'var(--accent-blue)';
            ind.querySelector('.mdc-chip__label').textContent = 'Live';
        }
    }

    // --- Render: Game Card ---
    function renderGameCard(game, idx) {
        const sc = game.state === 'in' ? 'mdc-game-card--live' :
                   game.state === 'post' ? 'mdc-game-card--final' : '';
        const showScores = game.state !== 'pre';

        let statusHTML;
        if (game.state === 'in') {
            statusHTML = `<span class="mdc-game-card__status mdc-game-card__status--live">
                <span class="mdc-live-badge"><span class="mdc-live-badge__dot"></span>LIVE</span>
                ${game.clock ? `${game.period}H ${game.clock}` : ''}
            </span>`;
        } else if (game.state === 'post') {
            statusHTML = `<span class="mdc-game-card__status mdc-game-card__status--final">
                <span class="material-icons-round" style="font-size:14px">check_circle</span> Final
            </span>`;
        } else {
            statusHTML = `<span class="mdc-game-card__status">
                <span class="material-icons-outlined" style="font-size:14px">schedule</span>
                ${formatTimeLocal(game.date)}
            </span>`;
        }

        const teamRow = (team) => {
            if (!team) return '';
            const wc = game.completed ? (team.isWinner ? 'mdc-team-row--winner' : 'mdc-team-row--loser') : '';
            return `
                <div class="mdc-team-row ${wc}">
                    <img class="mdc-team-row__logo" src="${team.logo}" alt="${team.name}" loading="lazy"
                         onerror="this.src='${fallbackImg()}'">
                    <div class="mdc-team-row__info">
                        <div class="mdc-team-row__name-line">
                            ${team.seed ? `<span class="mdc-team-row__seed">${team.seed}</span>` : ''}
                            <span class="mdc-team-row__name">${team.short}</span>
                        </div>
                        <div class="mdc-team-row__record">${team.record}</div>
                    </div>
                    ${showScores ? `<span class="mdc-team-row__score">${team.score}</span>` : ''}
                </div>`;
        };

        const card = document.createElement('div');
        card.className = `mdc-game-card ${sc}`;
        card.style.animationDelay = `${idx * 50}ms`;
        card.innerHTML = `
            <div class="mdc-game-card__header">
                <span class="mdc-game-card__region">${game.region || game.round || ''}</span>
                ${statusHTML}
            </div>
            <div class="mdc-game-card__teams">
                ${teamRow(game.away)}
                <div class="mdc-game-card__divider"></div>
                ${teamRow(game.home)}
            </div>
            <div class="mdc-game-card__details">
                <div class="mdc-detail">
                    <span class="material-icons-outlined">tv</span>
                    <span class="mdc-detail__value">${game.broadcast}</span>
                </div>
                <div class="mdc-detail">
                    <span class="material-icons-outlined">location_on</span>
                    <span class="mdc-detail__value">${game.city || 'TBD'}</span>
                </div>
            </div>
            ${(game.spread || game.prediction) ? `
                <div class="mdc-game-card__odds">
                    ${game.spread ? `<div class="mdc-odds-item"><span class="mdc-odds-item__label">Spread</span><span class="mdc-odds-item__value">${game.spread}</span></div>` : ''}
                    ${game.overUnder ? `<div class="mdc-odds-item"><span class="mdc-odds-item__label">Total</span><span class="mdc-odds-item__value">${game.overUnder}</span></div>` : ''}
                    ${game.prediction ? `<div class="mdc-prediction-chip"><span class="material-icons-round">auto_awesome</span>${game.prediction}</div>` : ''}
                </div>` : ''}
        `;
        card.addEventListener('click', () => openModal(game));
        return card;
    }

    // --- Render: Card Grid ---
    function renderCards() {
        const filtered = getFiltered();
        
        // Smart DOM update: Check if the exact same list of games is already rendered
        const currentCards = Array.from(gamesContainer.children);
        const isSameList = currentCards.length === filtered.length && 
                           filtered.every((g, i) => currentCards[i]?.dataset.gameId === g.id);

        if (isSameList) {
            // Update in-place to prevent screen flicker and scroll jumping
            filtered.forEach((g, i) => {
                const tempDiv = renderGameCard(g, i);
                const existingCard = currentCards[i];
                // Only update innerHTML if it actually changed, to prevent image reload flashes
                if (existingCard.innerHTML !== tempDiv.innerHTML) {
                    existingCard.innerHTML = tempDiv.innerHTML;
                    existingCard.className = tempDiv.className;
                    existingCard.onclick = () => openModal(g);
                }
            });
        } else {
            // Hard re-render (fallback for when games change, like switching filter tabs)
            gamesContainer.innerHTML = '';
            if (filtered.length === 0) {
                noGamesContainer.style.display = 'block';
                gamesContainer.style.display = 'none';
            } else {
                noGamesContainer.style.display = 'none';
                gamesContainer.style.display = 'grid';
                filtered.forEach((g, i) => {
                    const card = renderGameCard(g, i);
                    card.dataset.gameId = g.id;
                    card.onclick = () => openModal(g);
                    gamesContainer.appendChild(card);
                });
            }
        }
    }

    // --- Render: Bracket ---
    let bracketData = null;

    async function fetchAllBracketData() {
        if (bracketData) return bracketData;
        const allGames = [];
        const promises = TOURNAMENT_DATES.map(async d => {
            try { return (await fetchGames(d)).map(extractGame); }
            catch { return []; }
        });
        const results = await Promise.all(promises);
        results.forEach(g => allGames.push(...g));
        bracketData = allGames;
        return allGames;
    }

    function bracketMatchupHTML(game) {
        if (!game) {
            return `<div class="bracket-matchup bracket-matchup--tbd">
                <div class="bracket-team"><img class="bracket-team-logo" src="${fallbackImg()}" alt=""><span class="bracket-team-name">TBD</span></div>
                <div class="bracket-team"><img class="bracket-team-logo" src="${fallbackImg()}" alt=""><span class="bracket-team-name">TBD</span></div>
            </div>`;
        }
        const showScores = game.state !== 'pre';
        const teamRow = (team) => {
            if (!team) return `<div class="bracket-team"><img class="bracket-team-logo" src="${fallbackImg()}" alt=""><span class="bracket-team-name">TBD</span></div>`;
            const wc = game.completed ? (team.isWinner ? 'bracket-team--winner' : 'bracket-team--loser') : '';
            const logoSrc = team.logo || fallbackImg();
            return `<div class="bracket-team ${wc}">
                <img class="bracket-team-logo" src="${logoSrc}" alt="" loading="lazy" onerror="this.src='${fallbackImg()}'">
                ${team.seed ? `<span class="bracket-team-seed">${team.seed}</span>` : ''}
                <span class="bracket-team-name">${team.short}</span>
                ${showScores ? `<span class="bracket-team-score">${team.score}</span>` : ''}
            </div>`;
        };

        let statusText = '';
        if (game.state === 'in') {
            statusText = `🔴 ${game.clock || 'Live'}`;
        } else if (game.state === 'post') {
            statusText = '✓ Final';
        } else {
            // Show TBD if teams aren't determined yet, or time is a placeholder
            const bothTeamsTBD = (!game.away || game.away.short === 'TBD') && (!game.home || game.home.short === 'TBD');
            const broadcastTBD = !game.broadcast || game.broadcast === 'TBD';
            if (bothTeamsTBD || broadcastTBD) {
                statusText = 'TBD';
            } else {
                statusText = formatTimeLocal(game.date);
            }
        }

        return `<div class="bracket-matchup" data-game-id="${game.id}">
            ${teamRow(game.away)}
            ${teamRow(game.home)}
            <div class="bracket-matchup-status">
                <span>${statusText}</span>
                <span>${game.broadcast}</span>
            </div>
        </div>`;
    }

    function getMatchupSortKey(game) {
        if (!game) return 99;
        const sAway = parseInt(game.away?.seed || 99);
        const sHome = parseInt(game.home?.seed || 99);
        const s = Math.min(sAway, sHome);

        // Standard hierarchies (Root Seed Order)
        const round1Order = [1, 8, 5, 4, 6, 3, 7, 2];

        // R64 check
        if (!game.round || game.round === '1st Round') {
            const idx = round1Order.indexOf(s);
            return idx >= 0 ? idx : 99;
        }

        // R32 check (Winner of 1/16 and 8/9 meet in Slot 0, 5/12 and 4/13 in Slot 1, etc.)
        const r2Pairs = [[1,16,8,9], [5,12,4,13], [6,11,3,14], [7,10,2,15]];
        if (game.round === '2nd Round') {
            const pairIdx = r2Pairs.findIndex(p => p.includes(sAway) || p.includes(sHome));
            return pairIdx >= 0 ? pairIdx : 99;
        }

        // Sweet 16 (Winner of Slot 0/1 from R32 meet)
        const s16Groups = [[1,16,8,9,5,12,4,13], [6,11,3,14,7,10,2,15]];
        if (game.round === 'Sweet 16') {
            const grpIdx = s16Groups.findIndex(g => g.includes(sAway) || g.includes(sHome));
            return grpIdx >= 0 ? grpIdx : 99;
        }

        return 0; // Elite 8 is only 1 game per region
    }

    function renderBracketRegion(regionName, regionMap) {
        const roundNames = ['1st Round', '2nd Round', 'Sweet 16', 'Elite 8'];
        const regionDiv = document.createElement('div');
        regionDiv.className = 'bracket-region';
        regionDiv.innerHTML = `<div class="bracket-region__title-wrap"><span class="bracket-region__title">${regionName} Region</span></div>`;

        const tree = document.createElement('div');
        tree.className = 'bracket-tree';

        roundNames.forEach((roundName, roundIdx) => {
            const slots = regionMap[roundName] || [];
            const expectedCount = slots.length;

            if (roundIdx > 0) {
                const connector = document.createElement('div');
                connector.className = 'bracket-connector';
                for (let i = 0; i < expectedCount; i++) {
                    const cp = document.createElement('div');
                    cp.className = 'bracket-connector-pair';
                    connector.appendChild(cp);
                }
                tree.appendChild(connector);
            }

            const roundCol = document.createElement('div');
            roundCol.className = 'bracket-round';
            roundCol.innerHTML = `<div class="bracket-round-label">${roundName}</div>`;

            const matchupsWrapper = document.createElement('div');
            matchupsWrapper.style.cssText = 'display:flex;flex-direction:column;justify-content:space-around;flex:1;gap:4px;';

            slots.forEach(game => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = bracketMatchupHTML(game);
                const matchupEl = wrapper.firstElementChild;
                if (game) matchupEl.addEventListener('click', () => openModal(game));
                matchupsWrapper.appendChild(matchupEl);
            });

            roundCol.appendChild(matchupsWrapper);
            tree.appendChild(roundCol);
        });

        regionDiv.appendChild(tree);
        return regionDiv;
    }

    async function renderBracket() {
        if (bracketContent.children.length === 0 || bracketContent.querySelector('.mdc-empty-state')) {
            bracketContent.innerHTML = `
                <div class="bracket-scroll-hint"><span class="material-icons-round">swipe</span> Scroll horizontally to see the full bracket</div>
                <div style="text-align:center;padding:40px;">
                    <div class="mdc-progress-circular" style="width:32px;height:32px;"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"></circle></svg></div>
                    <p style="margin-top:12px;font-size:13px;color:var(--md-on-surface-variant);">Loading full bracket...</p>
                </div>`;
        }

        try {
            const allGames = await fetchAllBracketData();
            const roundsOrder = ['1st Round', '2nd Round', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
            const regionsList = ['East', 'West', 'South', 'Midwest', 'Final Four', 'National'];
            
            const regionMaps = {};

            regionsList.forEach(reg => {
                const regGames = allGames.filter(g => g.region === reg || (reg === 'Final Four' && g.round === 'Final Four') || (reg === 'National' && g.round === 'Championship'));
                
                const bracketMap = {
                    '1st Round': new Array(8).fill(null),
                    '2nd Round': new Array(4).fill(null),
                    'Sweet 16': new Array(2).fill(null),
                    'Elite 8': new Array(1).fill(null),
                    'Final Four': new Array(2).fill(null),
                    'Championship': new Array(1).fill(null)
                };

                const unsorted = [];
                regGames.forEach(g => {
                    if (bracketMap[g.round]) {
                        const slot = getMatchupSortKey(g);
                        if (slot < bracketMap[g.round].length && !bracketMap[g.round][slot]) {
                            bracketMap[g.round][slot] = g;
                        } else {
                            unsorted.push(g);
                        }
                    }
                });
                
                unsorted.forEach(g => {
                    const slots = bracketMap[g.round];
                    const openIdx = slots.indexOf(null);
                    if (openIdx >= 0) slots[openIdx] = g;
                });
                
                // Propagate
                roundsOrder.forEach((rd, rdIdx) => {
                    if (rdIdx >= roundsOrder.length - 1) return;
                    const nextRd = roundsOrder[rdIdx + 1];
                    const currentSlots = bracketMap[rd];
                    const nextSlots = bracketMap[nextRd];
                    if (!currentSlots || !nextSlots) return;

                    currentSlots.forEach((game, gIdx) => {
                        if (game && game.completed && (game.home?.isWinner || game.away?.isWinner)) {
                            const winner = game.home?.isWinner ? game.home : game.away;
                            const targetIdx = Math.floor(gIdx / 2);
                            const isAwaySlot = (gIdx % 2 === 0);
                            
                            let targetGame = nextSlots[targetIdx];
                            if (!targetGame) {
                                targetGame = {
                                    id: `ghost-${reg}-${nextRd}-${targetIdx}`,
                                    round: nextRd,
                                    region: reg,
                                    status: 'TBD',
                                    state: 'pre',
                                    away: null,
                                    home: null,
                                    date: new Date().toISOString(),
                                    notes: nextRd,
                                    broadcast: ''
                                };
                                nextSlots[targetIdx] = targetGame;
                            }

                            if (isAwaySlot && (!targetGame.away || targetGame.away.name.includes('TBD'))) {
                                targetGame.away = { ...winner, isWinner: false, score: '0' };
                            } else if (!isAwaySlot && (!targetGame.home || targetGame.home.name.includes('TBD'))) {
                                targetGame.home = { ...winner, isWinner: false, score: '0' };
                            }
                        }
                    });
                });

                regionMaps[reg] = bracketMap;
            });

            // Standard DOM update - clearing for now to establish the new fixed structure
            bracketContent.innerHTML = '';
            const hint = document.createElement('div');
            hint.className = 'bracket-scroll-hint';
            hint.innerHTML = '<span class="material-icons-round">swipe</span> Scroll horizontally to see the full bracket';
            bracketContent.appendChild(hint);

            ['East', 'West', 'South', 'Midwest'].forEach(rName => {
                bracketContent.appendChild(renderBracketRegion(rName, regionMaps[rName]));
            });

            // Final Four & Championship
            const ffMap = regionMaps['Final Four'];
            const nMap = regionMaps['National'];
            if (ffMap && nMap) {
                const ffSection = document.createElement('div');
                ffSection.className = 'bracket-region';
                ffSection.innerHTML = '<div class="bracket-region__title-wrap"><span class="bracket-region__title">Final Four & Championship</span></div>';
                const ffTree = document.createElement('div');
                ffTree.className = 'bracket-tree';
                ffTree.style.justifyContent = 'center';

                // Final Four
                const ffRound = document.createElement('div');
                ffRound.className = 'bracket-round';
                ffRound.innerHTML = '<div class="bracket-round-label">Final Four</div>';
                const ffWrapper = document.createElement('div');
                ffWrapper.style.cssText = 'display:flex;flex-direction:column;justify-content:space-around;flex:1;gap:4px;';
                ffMap['Final Four'].forEach(game => {
                    const w = document.createElement('div');
                    w.innerHTML = bracketMatchupHTML(game);
                    const el = w.firstElementChild;
                    if (game) el.addEventListener('click', () => openModal(game));
                    ffWrapper.appendChild(el);
                });
                ffRound.appendChild(ffWrapper);
                ffTree.appendChild(ffRound);

                const conn1 = document.createElement('div');
                conn1.className = 'bracket-connector';
                conn1.innerHTML = '<div class="bracket-connector-pair"></div>';
                ffTree.appendChild(conn1);

                // Champ
                const chRound = document.createElement('div');
                chRound.className = 'bracket-round';
                chRound.innerHTML = '<div class="bracket-round-label">Championship</div>';
                const chWrapper = document.createElement('div');
                chWrapper.style.cssText = 'display:flex;flex-direction:column;justify-content:center;flex:1;gap:4px;';
                nMap['Championship'].forEach(game => {
                    const w = document.createElement('div');
                    w.innerHTML = bracketMatchupHTML(game);
                    const el = w.firstElementChild;
                    if (game) el.addEventListener('click', () => openModal(game));
                    chWrapper.appendChild(el);
                });
                chRound.appendChild(chWrapper);
                ffTree.appendChild(chRound);

                const conn2 = document.createElement('div');
                conn2.className = 'bracket-connector';
                conn2.style.width = '16px';
                conn2.style.minWidth = '16px';
                ffTree.appendChild(conn2);

                const champCol = document.createElement('div');
                champCol.className = 'bracket-round';
                const finalGame = nMap['Championship'][0];
                let champTeam = 'TBD';
                if (finalGame && finalGame.completed) {
                    champTeam = (finalGame.home?.isWinner ? finalGame.home?.short : finalGame.away?.short) || 'TBD';
                }

                champCol.innerHTML = `
                    <div class="bracket-round-label">Champion</div>
                    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;flex:1;gap:8px;">
                        <div class="bracket-champion">
                            <div class="bracket-champion__trophy">🏆</div>
                            <div class="bracket-champion__label">National Champion</div>
                            <div class="bracket-champion__team">${champTeam}</div>
                        </div>
                    </div>`;
                ffTree.appendChild(champCol);

                ffSection.appendChild(ffTree);
                bracketContent.appendChild(ffSection);
            }

        } catch (err) {
            console.error('Bracket fetch failed:', err);
            bracketContent.innerHTML = '<div class="mdc-empty-state"><span class="material-icons-outlined mdc-empty-state__icon mdc-empty-state__icon--error">cloud_off</span><h2 class="mdc-empty-state__title">Failed to Load Bracket</h2><p class="mdc-empty-state__body">Could not fetch tournament data.</p></div>';
        }
    }

    // --- Filter / View ---
    function getFiltered() {
        let filtered = [];
        if (currentFilter === 'live') filtered = allEvents.filter(g => g.state === 'in');
        else if (currentFilter === 'upcoming') filtered = allEvents.filter(g => g.state === 'pre');
        else if (currentFilter === 'completed') filtered = allEvents.filter(g => g.state === 'post');
        else filtered = [...allEvents];

        // Status Sorting: Live -> Upcoming -> Final
        return filtered.sort((a, b) => {
            const order = { 'in': 0, 'pre': 1, 'post': 2 };
            return (order[a.state] ?? 1) - (order[b.state] ?? 1);
        });
    }

    function updateView() {
        if (currentView === 'cards') {
            gamesContainer.style.display = 'grid';
            bracketContainer.style.display = 'none';
            betsContainer.style.display = 'none';
            renderCards();
        } else if (currentView === 'bracket') {
            gamesContainer.style.display = 'none';
            bracketContainer.style.display = 'block';
            betsContainer.style.display = 'none';
            noGamesContainer.style.display = 'none';
            renderBracket();
        } else if (currentView === 'bets') {
            gamesContainer.style.display = 'none';
            bracketContainer.style.display = 'none';
            betsContainer.style.display = 'block';
            noGamesContainer.style.display = 'none';
            renderBets();
        }
    }

    // --- Render: Bets ---
    function renderBets() {
        if (suggestedBetsCache.length === 0) {
            betsContainer.innerHTML = '<div class="mdc-empty-state"><span class="material-icons-outlined mdc-empty-state__icon">money_off</span><h2 class="mdc-empty-state__title">No Bets Available</h2><p class="mdc-empty-state__body">No suggested bets have been generated yet.</p></div>';
            return;
        }

        const getBetColor = (type) => {
            const colors = {
                'Sharp Money': '#FF5722',   // Deep Orange
                'Upset Alert': '#2196F3',   // Blue
                'Plus Money': '#673AB7',    // Deep Purple
                'Coin Flip': '#4CAF50',     // Green
                'Base Pick': '#607D8B'      // Grey
            };
            return colors[type] || 'var(--md-primary)';
        };

        // --- Persistent Architecture ---
        let filterRow = betsContainer.querySelector('.mdc-bet-filters');
        let grid = betsContainer.querySelector('.mdc-bets-grid');

        if (!filterRow || !grid) {
            betsContainer.innerHTML = '';
            filterRow = document.createElement('div');
            filterRow.className = 'mdc-bet-filters';
            betsContainer.appendChild(filterRow);

            grid = document.createElement('div');
            grid.className = 'mdc-bets-grid mdc-card-grid'; // Reuse layout logic
            betsContainer.appendChild(grid);
        }

        // --- Standardized Filter Chips ---
        const types = ['All', 'Sharp Money', 'Upset Alert', 'Plus Money', 'Coin Flip', 'Base Pick'];
        filterRow.innerHTML = ''; 
        types.forEach(type => {
            const chip = document.createElement('button');
            const isActive = (type === 'All' && currentBetTypeFilter === 'all') || (type === currentBetTypeFilter);
            chip.className = `mdc-bet-filter-chip${isActive ? ' mdc-bet-filter-chip--active' : ''}`;
            const label = document.createElement('span');
            label.className = 'mdc-bet-filter-chip__label';
            label.textContent = type;
            if (isActive) {
                const icon = document.createElement('span');
                icon.className = 'material-icons-round mdc-bet-filter-chip__icon';
                icon.textContent = 'check';
                chip.appendChild(icon);
            }
            chip.appendChild(label);
            const color = type === 'All' ? 'var(--md-primary)' : getBetColor(type);
            chip.style.backgroundColor = color;
            chip.style.color = '#fff';
            chip.onclick = () => { currentBetTypeFilter = type === 'All' ? 'all' : type; renderBets(); };
            filterRow.appendChild(chip);
        });

        // --- Dynamic Filter & Sort ---
        const filteredBets = suggestedBetsCache.filter(bet => {
            const game = allEvents.find(g => g.id === bet.gameId);
            const statusMatch = game && (currentFilter === 'all' || game.state === (currentFilter === 'live' ? 'in' : currentFilter === 'upcoming' ? 'pre' : 'post'));
            const typeMatch = currentBetTypeFilter === 'all' || bet.type === currentBetTypeFilter;
            return game && statusMatch && typeMatch;
        });

        // Strict Ranking / Heuristic Sort
        filteredBets.sort((a, b) => b.score - a.score);

        if (filteredBets.length === 0) {
            grid.innerHTML = `<div class="mdc-empty-state" style="grid-column: 1 / -1;"><span class="material-icons-outlined mdc-empty-state__icon">filter_list</span><h2 class="mdc-empty-state__title">No Matches</h2><p class="mdc-empty-state__body">No ${currentBetTypeFilter === 'all' ? '' : currentBetTypeFilter} bets currently match your criteria.</p></div>`;
            return;
        } else {
            const empty = grid.querySelector('.mdc-empty-state');
            if (empty) grid.innerHTML = '';
        }

        // --- Surgical Live Update ---
        const activeIds = new Set();
        filteredBets.forEach((bet, index) => {
            const betId = `bet-${bet.gameId}-${bet.type.replace(/\s+/g, '-')}`;
            activeIds.add(betId);
            const game = allEvents.find(g => g.id === bet.gameId);
            if (!game) return;

            // Generate Content Components
            let liveStatusHtml = '';
            if (game.state !== 'pre' && game.home && game.away) {
                const homeScore = parseInt(game.home.score || '0');
                const awayScore = parseInt(game.away.score || '0');
                const margin = homeScore - awayScore; 
                const pLow = bet.pick.toLowerCase();
                let betOnHome = (pLow.includes(game.home.short.toLowerCase()) || (game.home.abbr && pLow.includes(game.home.abbr.toLowerCase())) || pLow.includes(game.home.name.toLowerCase()));
                if (pLow.startsWith("opponent of")) betOnHome = !betOnHome;
                const pickSpreadMatch = bet.pick.match(/-?[\d.]+/);
                const pickSpread = pickSpreadMatch ? parseFloat(pickSpreadMatch[0]) : 0;
                const isCovering = betOnHome ? (margin > -pickSpread) : (-margin > -pickSpread);
                const color = isCovering ? 'var(--accent-green)' : 'var(--accent-live)';
                const icon = isCovering ? 'check_circle' : 'cancel';
                const statusTxt = game.state === 'in' ? 'LIVE COVER:' : 'FINAL RESULT:';
                liveStatusHtml = `<div style="margin-top: 12px; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 6px; font-size: 13px; font-weight: 600; display:flex; align-items:center; gap:6px;"><span class="material-icons-round" style="color: ${color}; font-size:16px;">${icon}</span>${statusTxt} ${isCovering ? 'WINNING' : 'LOSING'}<span style="margin-left:auto; font-weight:400; color:var(--md-on-surface-variant)">Score: ${game.away.short} ${awayScore} - ${game.home.short} ${homeScore}</span></div>`;
            }

            const innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="mdc-game-card__region" style="background:${getBetColor(bet.type)}; color:#fff; text-shadow:0 1px 1px rgba(0,0,0,0.1)">${bet.type}</span>
                        <span style="font-size:11px; font-weight:600; color:var(--md-on-surface-variant); display:flex; align-items:center; gap:4px; opacity:0.8;">
                            <span class="material-icons-round" style="font-size:12px">schedule</span>
                            ${bet.gameTime || 'TBD'}
                        </span>
                    </div>
                    <span class="mdc-chip--live" style="background:var(--md-surface-variant); border:none; color:var(--md-on-surface);"><span class="material-icons-round" style="font-size:12px">insights</span> ${bet.confidence} Conf</span>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: var(--md-on-surface); margin-bottom: 6px;">
                    Pick: ${bet.pick} <span style="font-weight: 500; font-size: 14px; margin-left:8px; color: var(--accent-blue)">(${bet.odds})</span>
                </div>
                <div style="font-size: 13px; color: var(--md-on-surface-variant); line-height: 1.5;">
                    ${bet.reason}
                </div>
                ${liveStatusHtml}
            `;

            let card = document.getElementById(betId);
            if (card) {
                // Update only if changed
                if (card.dataset.contentHash !== btoa(innerHTML).slice(0, 32)) {
                    card.innerHTML = innerHTML;
                    card.dataset.contentHash = btoa(innerHTML).slice(0, 32);
                }
            } else {
                card = document.createElement('div');
                card.id = betId;
                card.className = 'mdc-game-card';
                card.style.padding = '16px';
                card.style.transition = 'all 0.3s ease';
                card.innerHTML = innerHTML;
                card.dataset.contentHash = btoa(innerHTML).slice(0, 32);
                grid.appendChild(card);
            }
            card.style.order = index; // Ranking order
        });

        // Cleanup stale bets
        grid.querySelectorAll('.mdc-game-card').forEach(c => { if (!activeIds.has(c.id)) c.remove(); });
    }

    // --- Modal ---
    function openModal(game) {
        const show = game.state !== 'pre';
        const leaderHTML = (team) => {
            if (!team?.leaders?.length) return '';
            return team.leaders.map(l => `
                <div class="modal-leader">
                    ${l.photo ? `<img class="modal-leader-photo" src="${l.photo}" alt="${l.player}" loading="lazy" onerror="this.style.display='none'">` : ''}
                    <div class="modal-leader-info">
                        <div class="modal-leader-name">${l.player}</div>
                        <div class="modal-leader-stat">${l.cat} · ${team.short}</div>
                    </div>
                    <div class="modal-leader-value">${l.val}</div>
                </div>
            `).join('');
        };

        const wc = (team) => game.completed && team ? (team.isWinner ? 'mdc-team-row--winner' : 'mdc-team-row--loser') : '';

        modalContent.innerHTML = `
            <div class="modal-teams">
                <div class="modal-team ${wc(game.away)}">
                    <img class="modal-team-logo" src="${game.away?.logo || ''}" alt="" loading="lazy" onerror="this.src='${fallbackImg()}'">
                    <div class="modal-team-info">
                        <div class="modal-team-name">${game.away?.seed ? `<span class="mdc-team-row__seed">${game.away.seed}</span> ` : ''}${game.away?.name || 'TBD'}</div>
                        <div class="modal-team-record">${game.away?.record || ''}</div>
                    </div>
                    ${show ? `<div class="modal-team-score">${game.away?.score || ''}</div>` : ''}
                </div>
                <div class="modal-vs">VS</div>
                <div class="modal-team ${wc(game.home)}">
                    <img class="modal-team-logo" src="${game.home?.logo || ''}" alt="" loading="lazy" onerror="this.src='${fallbackImg()}'">
                    <div class="modal-team-info">
                        <div class="modal-team-name">${game.home?.seed ? `<span class="mdc-team-row__seed">${game.home.seed}</span> ` : ''}${game.home?.name || 'TBD'}</div>
                        <div class="modal-team-record">${game.home?.record || ''}</div>
                    </div>
                    ${show ? `<div class="modal-team-score">${game.home?.score || ''}</div>` : ''}
                </div>
            </div>

            <div class="modal-section">
                <div class="modal-section-title"><span class="material-icons-outlined">info</span> Game Info</div>
                <div class="modal-detail-grid">
                    <div class="modal-detail-item">
                        <div class="modal-detail-label">Time</div>
                        <div class="modal-detail-value"><span class="material-icons-outlined">schedule</span>${game.statusDetail || formatTimeLocal(game.date)}</div>
                    </div>
                    <div class="modal-detail-item">
                        <div class="modal-detail-label">TV</div>
                        <div class="modal-detail-value"><span class="material-icons-outlined">tv</span>${game.broadcast}</div>
                    </div>
                    <div class="modal-detail-item">
                        <div class="modal-detail-label">Location</div>
                        <div class="modal-detail-value"><span class="material-icons-outlined">location_on</span>${game.city || 'TBD'}</div>
                    </div>
                    ${game.notes ? `<div class="modal-detail-item"><div class="modal-detail-label">Round</div><div class="modal-detail-value"><span class="material-icons-outlined">emoji_events</span>${game.notes}</div></div>` : ''}
                </div>
            </div>

            ${(game.spread || game.overUnder) ? `
            <div class="modal-section">
                <div class="modal-section-title"><span class="material-icons-outlined">trending_up</span> Odds & Lines</div>
                <div class="modal-odds-grid">
                    ${game.spread ? `<div class="modal-odds-item"><div class="modal-odds-label">Spread</div><div class="modal-odds-value">${game.spread}</div></div>` : ''}
                    ${game.overUnder ? `<div class="modal-odds-item"><div class="modal-odds-label">O/U</div><div class="modal-odds-value">${game.overUnder}</div></div>` : ''}
                    ${game.mlHome ? `<div class="modal-odds-item"><div class="modal-odds-label">${game.home?.abbr} ML</div><div class="modal-odds-value">${game.mlHome}</div></div>` : ''}
                    ${game.mlAway ? `<div class="modal-odds-item"><div class="modal-odds-label">${game.away?.abbr} ML</div><div class="modal-odds-value">${game.mlAway}</div></div>` : ''}
                </div>
            </div>` : ''}

            ${game.prediction ? `
            <div class="modal-section">
                <div class="modal-section-title"><span class="material-icons-outlined">auto_awesome</span> Prediction</div>
                <div class="modal-prediction-box">
                    <div class="modal-prediction-label">Projected Winner</div>
                    <div class="modal-prediction-value">${game.prediction}</div>
                    <div class="modal-prediction-reason">${game.predReason}</div>
                </div>
            </div>` : ''}

            ${(game.away?.leaders?.length || game.home?.leaders?.length) ? `
            <div class="modal-section">
                <div class="modal-section-title"><span class="material-icons-outlined">person</span> Season Leaders</div>
                ${leaderHTML(game.away)}
                ${leaderHTML(game.home)}
            </div>` : ''}

            ${game.espnLink ? `<div style="text-align:center;padding-top:8px;">
                <a class="modal-espn-link" href="${game.espnLink}" target="_blank" rel="noopener">
                    View on ESPN <span class="material-icons-round">open_in_new</span>
                </a>
            </div>` : ''}
        `;

        $('modal-title').textContent = game.name || 'Game Details';
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    // --- Setup ---
    function setupFilters() {
        document.querySelectorAll('.mdc-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.mdc-filter-chip').forEach(c => c.classList.remove('mdc-filter-chip--selected'));
                chip.classList.add('mdc-filter-chip--selected');
                currentFilter = chip.dataset.filter;
                updateView();
            });
        });
    }

    function setupViewToggle() {
        const btns = {
            'cards': $('view-cards'),
            'bracket': $('view-bracket'),
            'bets': $('view-bets')
        };
        
        Object.keys(btns).forEach(key => {
            btns[key].addEventListener('click', () => {
                currentView = key;
                Object.values(btns).forEach(b => b.classList.remove('mdc-segmented-btn--selected'));
                btns[key].classList.add('mdc-segmented-btn--selected');
                updateView();
            });
        });
    }

    function setupDateNav() {
        $('prev-date').addEventListener('click', () => {
            const i = TOURNAMENT_DATES.indexOf(currentDate);
            if (i > 0) { currentDate = TOURNAMENT_DATES[i - 1]; renderDatePills(); loadData(); }
        });
        $('next-date').addEventListener('click', () => {
            const i = TOURNAMENT_DATES.indexOf(currentDate);
            if (i < TOURNAMENT_DATES.length - 1) { currentDate = TOURNAMENT_DATES[i + 1]; renderDatePills(); loadData(); }
        });
    }

    function setupModal() {
        $('modal-close').addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    }

    // --- Load ---
    async function loadData(silent = false) {
        if (isLoading) return;
        isLoading = true;

        if (!silent) {
            loadingContainer.style.display = 'flex';
            errorContainer.style.display = 'none';
            noGamesContainer.style.display = 'none';
            gamesContainer.style.display = 'none';
            bracketContainer.style.display = 'none';
        }

        try {
            // First perfectly pull the latest server updates behind the scenes during polling
            if (silent) {
                try {
                    const dbRes = await fetch('default-odds.json?t=' + Date.now());
                    if (dbRes.ok) Object.assign(defaultOddsCache, await dbRes.json());
                } catch(e) {}
            }

            const raw = await fetchGames(currentDate);

            allEvents = raw.map(ev => extractGame(ev, silent));
            
            // 3. Generate Suggested Bets dynamically by comparing Default (Opening) vs Adjusted (Live) Lines
            // 3. Generate GLOBAL Suggested Bets by scanning the entire tournament field (R1/R2)
            // This ensures the Top 10 Bets feed reflects total tournament value, not just today
            // 3. Generate GLOBAL Suggested Bets by scanning the entire tournament field
            // Use all defined tournament dates from First Four through the Championship
            const poolPromises = TOURNAMENT_DATES.map(fetchGames);
            const poolRes = await Promise.all(poolPromises);
            const pool = poolRes.flat().map(ev => extractGame(ev, true));

            let freshBets = [];
            pool.forEach(game => {
                if (game.state === 'post') return; // Skip completed matchups (already hit/missed)
                const def = defaultOddsCache[game.id];
                const adj = adjustedOddsCache[game.id];
                if (!def) return; // Must have history

                // Helper to resolve actual team names from abbreviations/strings
                const getOpponent = (abbr) => {
                    if (!abbr) return 'TBD';
                    const a = abbr.toLowerCase().trim();
                    const isH = (game.home?.abbr?.toLowerCase() === a || game.home?.short?.toLowerCase() === a || game.home?.name?.toLowerCase() === a);
                    return isH ? (game.away?.short || 'Away Team') : (game.home?.short || 'Home Team');
                };
                const getTeam = (abbr) => {
                    if (!abbr) return 'TBD';
                    const a = abbr.toLowerCase().trim();
                    const isH = (game.home?.abbr?.toLowerCase() === a || game.home?.short?.toLowerCase() === a || game.home?.name?.toLowerCase() === a);
                    return isH ? (game.home?.short || abbr) : (game.away?.short || abbr);
                };

                // Factor 1: Include any custom specific predictions defined in odds.json
                if (def.prediction && def.predReason) {
                    freshBets.push({
                        gameId: game.id,
                        type: 'Base Pick',
                        pick: def.prediction,
                        odds: '-110',
                        reason: def.predReason,
                        confidence: 'Medium',
                        score: 40,
                        gameTime: game.statusDetail,
                        lastUpdated: Date.now()
                    });
                }
                
                // Factor 2: Deep Underdog vs Favorite Statistical Heuristics (Easy/High Value Bets)
                if (def.spread && game.state === 'pre') {
                    const match = def.spread.match(/([a-zA-Z\s]+?)\s*(-[\d.]+)/);
                    if (match) {
                        const favTeam = match[1].trim();
                        const spreadAmount = Math.abs(parseFloat(match[2]));
                        
                        if (spreadAmount > 15) {
                            const dog = getOpponent(favTeam);
                            freshBets.push({
                                gameId: game.id,
                                type: 'Upset Alert',
                                pick: `${dog} +${spreadAmount}`,
                                odds: '-110',
                                reason: `Heavy favorites (${favTeam}) are historically unreliable at covering massive mathematically inflated double-digit spreads. High value backing ${dog} with these points inside tourney pressure.`,
                                confidence: 'High',
                                score: 85,
                                gameTime: game.statusDetail,
                                lastUpdated: Date.now()
                            });
                        } else if (spreadAmount <= 3.5 && spreadAmount >= 1.0) {
                            const favor = getTeam(favTeam);
                            freshBets.push({
                                gameId: game.id,
                                type: 'Coin Flip',
                                pick: `${favor} -${spreadAmount}`,
                                odds: '-110',
                                reason: `In tight coin-flip spreads under 4 points, backing the slight mathematical favorite (${favor}) against standard public underdog narratives is a highly reliable winning strategy.`,
                                confidence: 'Medium',
                                score: 55,
                                gameTime: game.statusDetail,
                                lastUpdated: Date.now()
                            });
                        }
                    }
                }

                // Factor 3: Compare pre-game live adjustments to opening lines to find Sharp Money shifts
                if (game.state === 'pre' && def.spread && adj?.spread && def.spread !== adj.spread) {
                    const defMatch = def.spread.match(/([a-zA-Z\s]+?)\s*(-?[\d.]+)/);
                    const adjMatch = adj.spread.match(/([a-zA-Z\s]+?)\s*(-?[\d.]+)/);
                    
                    if (defMatch && adjMatch && defMatch[1].trim() === adjMatch[1].trim()) {
                        const defSpread = parseFloat(defMatch[2]);
                        const adjSpread = parseFloat(adjMatch[2]);
                        const lineDiff = adjSpread - defSpread;

                        // Identify significant line movement (1.0 points or more)
                        if (Math.abs(lineDiff) >= 1.0) {
                            const side = lineDiff < 0 ? getTeam(defMatch[1]) : getOpponent(defMatch[1]);
                            freshBets.push({
                                gameId: game.id,
                                type: 'Sharp Money',
                                pick: side,
                                odds: 'N/A',
                                reason: `Opening line was ${def.spread} but has moved heavily to ${adj.spread} (${Math.abs(lineDiff)} pt shift). Sharp cash is hammering ${side}, follow their lead.`,
                                confidence: Math.abs(lineDiff) >= 2.0 ? 'High' : 'Medium',
                                score: Math.abs(lineDiff) >= 2.0 ? 95 : 75,
                                gameTime: game.statusDetail,
                                lastUpdated: Date.now()
                            });
                        }
                    }
                }

                // Factor 4: Underdog Moneyline plays (Plus Money Longshot / Value bets)
                const mlH = adj?.mlHome || def.mlHome;
                const mlA = adj?.mlAway || def.mlAway;
                const checkML = (val, team) => {
                    if (!val) return;
                    const num = parseInt(val.replace('+', ''));
                    // Look for positive money between +110 and +400 for 'Value Longshots'
                    if (!isNaN(num) && num >= 110 && num <= 400) {
                        freshBets.push({
                            gameId: game.id,
                            type: 'Plus Money',
                            pick: `${team.short} (Moneyline)`,
                            odds: val.startsWith('+') ? val : `+${val}`,
                            reason: `Vegas is giving this dog a significant ${val} payout. Statistical projections indicate high risk but extreme potential value for users looking for a much larger payout than standard spreads.`,
                            confidence: 'Medium',
                            score: 65,
                            gameTime: game.statusDetail,
                            lastUpdated: Date.now()
                        });
                    }
                };
                if (game.home) checkML(mlH, game.home);
                if (game.away) checkML(mlA, game.away);
            });
            
            // Balance the candidate pool to ensure category diversity in your Top picks
            const categories = {};
            freshBets.forEach(b => { 
                if (!categories[b.type]) categories[b.type] = [];
                categories[b.type].push(b);
            });
            
            // Pick top candidates from each category to ensure variety, then fill with best overall
            let balanced = [];
            Object.values(categories).forEach(list => {
                list.sort((a,b) => b.score - a.score);
                balanced.push(...list.slice(0, 4)); // Get up to 4 of each type
            });
            
            balanced.sort((a,b) => b.score - a.score);
            // Slice to Top 20 to give the user enough "Other Options" while maintaining elite quality
            suggestedBetsCache = balanced.slice(0, 20);
            
            // Persist the generated suggested bets "database" into the browser as requested
            try { localStorage.setItem('suggested-bets.json', JSON.stringify(suggestedBetsCache)); } catch(e){}

            bracketData = null; // invalidate bracket cache
            allEvents.sort((a, b) => {
                const order = { 'in': 0, 'pre': 1, 'post': 2 };
                return (order[a.state] ?? 1) - (order[b.state] ?? 1) || new Date(a.date) - new Date(b.date);
            });

            if (!silent) loadingContainer.style.display = 'none';
            renderStats();
            updateView();

            // Restart polling logic automatically
            startPolling();
        } catch (err) {
            console.error('Load failed:', err);
            if (!silent) {
                loadingContainer.style.display = 'none';
                errorContainer.style.display = 'block';
            }
        }
        isLoading = false;
    }
    window.loadData = loadData;

    // Find closest date
    function closestDate() {
        const today = getTodayStr();
        if (TOURNAMENT_DATES.includes(today)) return today;
        for (const d of TOURNAMENT_DATES) { if (d >= today) return d; }
        return TOURNAMENT_DATES[TOURNAMENT_DATES.length - 1];
    }

    // Init
    async function init() {
        initTheme();
        currentDate = closestDate();
        renderDatePills();
        setupFilters();
        setupViewToggle();
        setupDateNav();
        setupModal();

        // Base Initial Load establishes Immutable History
        try {
            const res = await fetch('default-odds.json?t=' + Date.now());
            if (res.ok) {
                Object.assign(defaultOddsCache, await res.json());
                try { localStorage.setItem('default-odds.json', JSON.stringify(defaultOddsCache)); } catch(e){}
            }
        } catch (e) {
            console.log('No default odds network history found, relying on browser storage.');
        }

        loadData();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
