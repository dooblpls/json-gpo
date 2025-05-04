document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const navTreeElement = document.getElementById('nav-tree');
    const settingsListElement = document.getElementById('settings-list');
    const detailsContentElement = document.getElementById('details-content');
    const detailsPlaceholder = document.getElementById('details-placeholder');
    const globalSearchInput = document.getElementById('global-search');
    const settingsSearchInput = document.getElementById('settings-search');
    const languageSelect = document.getElementById('language-select');
    //const navSearchInput = document.getElementById('nav-search');

    // --- Constants ---
    const VIRTUAL_COMPUTER_ROOT_ID = 'VIRTUAL_COMPUTER_ROOT';
    const VIRTUAL_USER_ROOT_ID = 'VIRTUAL_USER_ROOT';

    // --- State Variables ---
    let allData = {};
    let currentLang = null;
    let categoriesMap = new Map();
    let policiesMap = new Map();
    let globalSearchTerm = '';
    let matchingPolicyIds = new Set();
    let lastSelectedCategoryId = null; // Original category ID
    let lastSelectedPolicyId = null;
    let lastSelectedContext = null; // NEW: Stores 'Machine' or 'User' based on clicked tree node
    let categoryClassCache = new Map();
    let isInitializing = true;

    // --- Debounce Function ---
    function debounce(func, wait) { /* ... (keep existing) ... */
        let timeout; return function executedFunction(...args) { const later = () => { clearTimeout(timeout); func(...args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); };
    }

    // --- URL Hash Handling ---
    function parseUrlHash() { /* ... (keep existing) ... */
        const hash = window.location.hash.substring(1); const params = new URLSearchParams(hash); return { lang: params.get('lang'), policy: params.get('policy') };
    }
    function updateUrlHash() { /* ... (keep existing) ... */
        if (isInitializing) return; const params = new URLSearchParams(); if (currentLang) params.set('lang', currentLang); if (lastSelectedPolicyId) params.set('policy', lastSelectedPolicyId); const newHash = params.toString(); const currentPath = window.location.pathname + window.location.search; if (('#' + newHash) !== window.location.hash) { console.log("Updating URL hash to:", newHash); history.replaceState(null, '', currentPath + (newHash ? '#' + newHash : '')); }
    }

    // --- Data Loading and Processing ---
    async function loadData(lang) { /* ... (keep existing) ... */
         const fileNameLang = lang.replace('-', '_'); try { const response = await fetch(`data_${fileNameLang}.json`); if (!response.ok) throw new Error(`Could not load ${fileNameLang}.json (HTTP ${response.status})`); const data = await response.json(); allData[lang] = data; console.log(`Loaded data for ${lang}`); return data; } catch (error) { console.error("Error loading data:", error); settingsListElement.innerHTML = ''; navTreeElement.innerHTML = ''; detailsContentElement.innerHTML = `<p class="text-red-600 p-4">Fehler: ${error.message}</p>`; return null; }
    }
    function processFlatData(data) { /* ... (keep existing) ... */
         categoriesMap.clear(); policiesMap.clear(); if (!data?.allCategories || !data?.allPolicies) { console.error("Invalid data structure", data); return; } data.allCategories.forEach(cat => { cat.searchText = `${cat.displayName || ''}`.toLowerCase(); categoriesMap.set(cat.id, cat); }); data.allPolicies.forEach(pol => { let regSearch = ''; if (pol.registry && typeof pol.registry === 'object') { if (pol.registry.key) regSearch += `${pol.registry.key} `; if (pol.registry.valueName) regSearch += `${pol.registry.valueName} `; if (pol.registry.elements?.length > 0) { pol.registry.elements.forEach(el => { if (el && typeof el === 'object') { if (el.valueName) regSearch += `${el.valueName} `; if (el.id) regSearch += `${el.id} `; if (el.options?.length > 0) { el.options.forEach(opt => { if (opt?.display) regSearch += `${opt.display} `; }); } } }); } if (pol.registry.options?.length > 0) { pol.registry.options.forEach(opt => { if (opt?.display) regSearch += `${opt.display} `; }); } } pol.searchText = `${pol.displayName || ''} ${pol.explainText || ''} ${regSearch}`.toLowerCase().replace(/\s+/g, ' ').trim(); policiesMap.set(pol.id, pol); }); console.log("Processed data.");
    }

    // --- Navigation Tree Rendering ---
    function categoryContainsClass(categoryId, targetClass) { /* ... (keep existing) ... */
        const cacheKey = `${categoryId}:${targetClass}`; if (categoryClassCache.has(cacheKey)) return categoryClassCache.get(cacheKey); const category = categoriesMap.get(categoryId); if (!category || categoryId === 'ROOT' || categoryId.startsWith('VIRTUAL_')) return false; if (Array.isArray(category.policies)) { for (const policyId of category.policies) { const policy = policiesMap.get(policyId); if (policy && (policy.class === targetClass || policy.class === 'Both')) { categoryClassCache.set(cacheKey, true); return true; } } } if (Array.isArray(category.children)) { for (const childId of category.children) { if (categoryContainsClass(childId, targetClass)) { categoryClassCache.set(cacheKey, true); return true; } } } categoryClassCache.set(cacheKey, false); return false;
    }

    // REVISED: Renders category including the context ('Machine' or 'User')
    function renderSingleCategoryRecursive(categoryId, context) { // Add context parameter
         const category = categoriesMap.get(categoryId);
         if (!category) return '';

         // Check if this specific category node should be rendered in this context
         // It must contain policies (directly or indirectly) relevant to the context.
         if (!categoryContainsClass(categoryId, context)) {
              // However, we might need to render it if a *child* category contains relevant policies
              let hasRelevantChild = false;
              if (Array.isArray(category.children)) {
                  for(const childId of category.children) {
                      if (categoryContainsClass(childId, context)) {
                          hasRelevantChild = true;
                          break;
                      }
                  }
              }
              if (!hasRelevantChild) {
                   // console.log(`Skipping category ${categoryId} (${category.displayName}) in context ${context} - no relevant policies/children.`);
                  return ''; // Skip rendering this category in this context branch
              }
         }


         const childrenIds = Array.isArray(category.children) ? category.children : [];
         const hasChildren = childrenIds.length > 0;

         // Build child HTML first, passing down the context
         let childrenHtml = '';
         if (hasChildren) {
              childrenIds.forEach(childId => {
                 childrenHtml += renderSingleCategoryRecursive(childId, context); // Pass context down
              });
         }

         // Only render the LI if it actually has content (either direct policies relevant to context or relevant children)
         const hasRelevantDirectPolicies = Array.isArray(category.policies) &&
            category.policies.some(pid => {
                const p = policiesMap.get(pid);
                return p && (p.class === context || p.class === 'Both');
            });

         // If it has no relevant childrenHtml AND no relevant direct policies, skip rendering the LI
         if (childrenHtml === '' && !hasRelevantDirectPolicies) {
             // This category might be relevant *only* because a deeper child is relevant.
             // We still need the structure, but maybe hide the name if it has no direct policies?
             // Let's render it for structure, but the selectCategory check handles policy display.
              // console.log(`Category ${categoryId} rendered for structure in context ${context}, but no direct/child content`);
             // Let's still render the LI for structure if childrenHtml is empty but a deeper child might be relevant (covered by initial check)
         }


         // Generate unique ID for this specific node in the tree, including context
         const nodeTreeId = `${context}_${categoryId}`;

         // Add data-context attribute to the LI element
         let html = `<li data-tree-id="${nodeTreeId}" data-category-id="${category.id}" data-context="${context}" class="category-list-item original-category" style="display: list-item;">`;
         html += `<div class="flex items-center py-1">`;
         const hasVisibleChildren = childrenHtml !== ''; // Render toggle only if there are children to show in this context
         if (hasVisibleChildren) {
             html += `<span class="toggle collapsed mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▶</span>`;
         } else {
             html += `<span class="inline-block w-4 mr-1"></span>`; // Placeholder for alignment
         }
         // Pass the unique nodeTreeId to selectCategory
         html += `<span class="category-name flex-grow p-1 rounded hover:bg-gray-200 cursor-pointer" onclick="selectCategoryFromTree('${nodeTreeId}')">${category.displayName}</span>`;
         html += `</div>`;

         if (hasVisibleChildren) {
             // Sub-list starts hidden
             html += `<ul style="display: none;">${childrenHtml}</ul>`;
         }
         html += `</li>`;
         return html;
    }

    function getVirtualRootName(type) { /* ... (keep existing) ... */
         if (type === 'Computer') return currentLang === 'de-DE' ? 'Administrative Vorlagen: Computer' : 'Administrative Templates: Computer'; if (type === 'User') return currentLang === 'de-DE' ? 'Administrative Vorlagen: Benutzer' : 'Administrative Templates: User'; return 'Administrative Templates';
    }

    function renderNavTree() { // Render Computer/User roots and call helper with context
        navTreeElement.innerHTML = ''; categoryClassCache.clear();
        if (categoriesMap.size === 0 || !categoriesMap.has('ROOT')) { navTreeElement.innerHTML = '<p>Keine Kategorien.</p>'; return; }
        const rootCategory = categoriesMap.get('ROOT'); const originalTopLevelIds = Array.isArray(rootCategory?.children) ? rootCategory.children : []; let computerChildrenHtml = ''; let userChildrenHtml = '';

        originalTopLevelIds.forEach(catId => {
            const category = categoriesMap.get(catId); if (!category) return;
            // Check if category OR its children contain Machine policies
            if (categoryContainsClass(catId, 'Machine')) {
                computerChildrenHtml += renderSingleCategoryRecursive(catId, 'Machine'); // Pass context
            }
            // Check if category OR its children contain User policies
            if (categoryContainsClass(catId, 'User')) {
                userChildrenHtml += renderSingleCategoryRecursive(catId, 'User'); // Pass context
            }
        });

        let finalHtml = '<ul>'; const hasComputerChildren = computerChildrenHtml !== ''; const hasUserChildren = userChildrenHtml !== '';
        // Computer Root
        finalHtml += `<li data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}" data-context="Machine" class="category-list-item top-level-virtual">`; /* ... (rest of virtual root rendering) ... */
         finalHtml += `<div class="flex items-center py-1 font-semibold">`; if (hasComputerChildren) finalHtml += `<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>`; else finalHtml += `<span class="inline-block w-4 mr-1"></span>`; finalHtml += `<span class="category-name flex-grow p-1 rounded">${getVirtualRootName('Computer')}</span>`; finalHtml += `</div>`; if (hasComputerChildren) finalHtml += `<ul style="display: block;">${computerChildrenHtml}</ul>`; finalHtml += `</li>`;
        // User Root
        finalHtml += `<li data-category-id="${VIRTUAL_USER_ROOT_ID}" data-context="User" class="category-list-item top-level-virtual">`; /* ... (rest of virtual root rendering) ... */
         finalHtml += `<div class="flex items-center py-1 font-semibold">`; if (hasUserChildren) finalHtml += `<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>`; else finalHtml += `<span class="inline-block w-4 mr-1"></span>`; finalHtml += `<span class="category-name flex-grow p-1 rounded">${getVirtualRootName('User')}</span>`; finalHtml += `</div>`; if (hasUserChildren) finalHtml += `<ul style="display: block;">${userChildrenHtml}</ul>`; finalHtml += `</li>`;
        finalHtml += '</ul>'; navTreeElement.innerHTML = finalHtml;
        // Apply filters AFTER rendering
        applyFilters();
    }


    // REVISED: Filters policies based on the lastSelectedContext
    function displaySettingsList(categoryId) {
        const category = categoriesMap.get(categoryId);
        settingsListElement.innerHTML = '';
        let displayedPolicyCount = 0;
        const middleSearchTerm = settingsSearchInput.value.toLowerCase().trim();
        const isGlobalSearchActive = globalSearchTerm !== '';

        // Use lastSelectedContext to filter policies!
        const currentContext = lastSelectedContext; // 'Machine' or 'User'

        if (category && Array.isArray(category.policies) && currentContext) { // Need context
            const categoryPolicyIds = category.policies;

            // 1. Filter by global search if active
            const globallyVisiblePolicyIds = isGlobalSearchActive
                ? categoryPolicyIds.filter(id => matchingPolicyIds.has(id))
                : categoryPolicyIds;

            // 2. Filter by CONTEXT ('Machine', 'User', 'Both')
            const contextFilteredPolicyIds = globallyVisiblePolicyIds.filter(id => {
                 const policy = policiesMap.get(id);
                 return policy && (policy.class === currentContext || policy.class === 'Both');
            });

            // 3. Sort the remaining policies
            const sortedPolicyIds = [...contextFilteredPolicyIds].sort((a, b) =>
                (policiesMap.get(a)?.displayName || '').localeCompare(policiesMap.get(b)?.displayName || '')
            );

            // 4. Filter by middle pane search and render
            sortedPolicyIds.forEach(policyId => {
                const policy = policiesMap.get(policyId);
                if (policy) {
                    if (!middleSearchTerm || policy.searchText.includes(middleSearchTerm)) {
                        const policyDiv = document.createElement('div');
                        policyDiv.className = 'setting-item p-2 border-b border-l-2 border-transparent cursor-pointer hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300';
                        policyDiv.textContent = policy.displayName;
                        policyDiv.setAttribute('onclick', `selectPolicy('${policyId}')`);
                        policyDiv.setAttribute('data-policy-id', policyId);
                        policyDiv.setAttribute('tabindex', '0');
                        policyDiv.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPolicy(policyId); } });
                        settingsListElement.appendChild(policyDiv);
                        displayedPolicyCount++;
                    }
                }
            });
        }

        // Message handling...
        if (displayedPolicyCount === 0) {
            if (!currentContext) {
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Kategorie auswählen.</p>';
            }
            else if (isGlobalSearchActive || middleSearchTerm) {
                settingsListElement.innerHTML = `<p class="text-gray-500 p-4">Keine passenden '${currentContext}'-Einstellungen gefunden.</p>`;
            } else if (category?.policies?.length === 0) {
                settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Keine Einstellungen definiert.</p>';
            } else {
                 // Category has policies, but none match the current context
                 settingsListElement.innerHTML = `<p class="text-gray-500 p-4">Keine '${currentContext}'-Einstellungen in dieser Kategorie.</p>`;
            }
        }
        settingsSearchInput.disabled = !(displayedPolicyCount > 0 || middleSearchTerm); // Disable only if list empty AND no search term
    }


    // --- Policy Details Display ---
    function displayPolicyDetails(policyId) {
        const policy = policiesMap.get(policyId);
        if (!policy) {
            clearDetails();
            return;
        }
        const detailNode = detailsPlaceholder.cloneNode(true);
        detailNode.style.display = 'block';
        detailNode.removeAttribute('id');
    
        detailNode.querySelector('#details-title').textContent = policy.displayName;
        detailNode.querySelector('#details-supported').textContent = policy.supportedOn + " (" + policy.admxFile +")" || 'Nicht angegeben';
        const explainHtml = (policy.explainText || 'Keine Beschreibung verfügbar.')
                              .replace(/</g, "<") // Escape <
                              .replace(/>/g, ">") // Escape >
                              .replace(/\n/g, '<br>'); // Convert newline to <br>
        detailNode.querySelector('#details-description').innerHTML = explainHtml;
    
        const registryElement = detailNode.querySelector('#details-registry');
        registryElement.innerHTML = '';
        if (policy.registry && typeof policy.registry === 'object') { // Check registry is object
            const reg = policy.registry;
            const classP = policy.class;
            const hiveMap = {
                User: "HKEY_CURRENT_USER",
                Machine: "HKEY_LOCAL_MACHINE",
                Both: "HKEY_LOCAL_MACHINE and HKEY_CURRENT_USER",
              };
            if (classP) {
                const classPElement = document.createElement('p');
                classPElement.innerHTML = `<strong>Klasse:</strong> ${hiveMap[classP] || "Unknown"}`;
                registryElement.appendChild(classPElement);
            }
            const keyP = document.createElement('p');
            keyP.innerHTML = `<strong>Pfad:</strong> ${reg.key || 'Nicht angegeben'}`;
            registryElement.appendChild(keyP);
    
            // Display top-level value if exists and no elements OR elements array is empty
            if (reg.valueName && (!reg.elements || (Array.isArray(reg.elements) && reg.elements.length === 0))) {
                const valueP = document.createElement('p');
                valueP.innerHTML = `<strong>Wert:</strong> ${reg.valueName}`;
                registryElement.appendChild(valueP);
                const typeP = document.createElement('p');
                typeP.innerHTML = `<strong>Typ:</strong> ${reg.type || 'Unbekannt'}`;
                registryElement.appendChild(typeP);
                if (reg.options && Array.isArray(reg.options)) {
                    const optionsList = document.createElement('ul');
                    optionsList.className = 'list-disc list-inside mt-1 pl-2';
                    optionsList.innerHTML = '<strong>Optionen:</strong>';
                    reg.options.forEach(opt => {
                         if (opt && typeof opt === 'object') { // Check opt object
                             const item = document.createElement('li');
                             item.textContent = `${opt.display || '?'}: ${opt.value !== undefined ? opt.value : '?'}`;
                             optionsList.appendChild(item);
                         }
                    });
                    registryElement.appendChild(optionsList);
                }
            }
    
            // Display elements if the array exists and has items
            if (reg.elements && Array.isArray(reg.elements) && reg.elements.length > 0) {
                const elementsTitle = document.createElement('h4');
                elementsTitle.className = 'font-medium mt-2 mb-1 text-gray-800';
                elementsTitle.textContent = 'Elemente:';
                registryElement.appendChild(elementsTitle);
                const elementsList = document.createElement('div');
                elementsList.className = 'space-y-2 ml-2 border-l-2 pl-3';
                reg.elements.forEach(elem => {
                    if (elem && typeof elem === 'object') { // Check elem object
                        const elemDiv = document.createElement('div');
                        elemDiv.className = 'border-b pb-1 mb-1 border-dashed';
                        let elemHtml = `<strong>${elem.valueName || elem.id || '?'}</strong> (${elem.type || 'Unbekannt'})`;
                        if (elem.minValue !== null && elem.minValue !== undefined) elemHtml += `, Min: ${elem.minValue}`;
                        if (elem.maxValue !== null && elem.maxValue !== undefined) elemHtml += `, Max: ${elem.maxValue}`;
                        if (elem.maxLength !== null && elem.maxLength !== undefined) elemHtml += `, Max Länge: ${elem.maxLength}`;
                        if (elem.required) elemHtml += `, Erforderlich`;
                        elemDiv.innerHTML = elemHtml;
                        if (elem.options && Array.isArray(elem.options)) {
                            const optionsList = document.createElement('ul');
                            optionsList.className = 'list-disc list-inside mt-1 pl-2 text-xs';
                            optionsList.innerHTML = '<strong>Optionen:</strong>';
                            elem.options.forEach(opt => {
                                if (opt && typeof opt === 'object') { // Check opt object
                                    const item = document.createElement('li');
                                    item.textContent = `${opt.display || '?'}: ${opt.value !== undefined ? opt.value : '?'}`;
                                    optionsList.appendChild(item);
                                }
                            });
                            elemDiv.appendChild(optionsList);
                        }
                        elementsList.appendChild(elemDiv);
                    }
                });
                registryElement.appendChild(elementsList);
    
                // Handle combined case: top-level valueName AND elements
                 if (reg.valueName) {
                     const mainValueInfo = document.createElement('p');
                     mainValueInfo.className = 'mt-2 text-xs italic';
                     const mainOptionsText = (reg.options && Array.isArray(reg.options))
                                             ? ` Optionen: ${reg.options.map(o => `${o.display || '?'}=${o.value !== undefined ? o.value : '?'}`).join('/')}`
                                             : '';
                     mainValueInfo.innerHTML = `(Hauptschalter: <strong>${reg.valueName}</strong> - Typ: ${reg.type || 'Unbekannt'}${mainOptionsText})`;
                     elementsTitle.before(mainValueInfo); // Display before elements list
                 }
            }
        } else {
            registryElement.textContent = 'Keine Registrierungsinformationen verfügbar.';
        }
    
        // Presentation Info
        const presentationContainer = detailNode.querySelector('#details-presentation-container');
        const presentationElement = detailNode.querySelector('#details-presentation');
        presentationElement.innerHTML = '';
        if (policy.presentation && policy.presentation.elements && Array.isArray(policy.presentation.elements)) {
            policy.presentation.elements.forEach(presElem => {
                 if (presElem && typeof presElem === 'object') { // Check presElem object
                     const presDiv = document.createElement('div');
                     presDiv.className = 'text-sm';
                     presDiv.innerHTML = `<strong>${presElem.label || presElem.type || '?'}</strong> <span class="text-xs text-gray-500">(${presElem.type || '?'}${presElem.refId ? `, ref: ${presElem.refId}` : ''})</span>`;
                     presentationElement.appendChild(presDiv);
                 }
            });
            presentationContainer.style.display = 'block';
        } else {
            presentationContainer.style.display = 'none';
        }
    
        detailsContentElement.innerHTML = '';
        detailsContentElement.appendChild(detailNode);
    }
    function clearDetails() { /* ... (keep existing + reset policy state) ... */
         detailsContentElement.innerHTML = '<h2 class="text-gray-500 p-6">Wählen Sie eine Einstellung.</h2>'; lastSelectedPolicyId = null; updateUrlHash();
    }

    // --- URL Expansion Helper ---
    function expandToCategory(categoryId) { /* ... (keep existing) ... */
        if (!categoryId || categoryId.startsWith('VIRTUAL_') || categoryId === 'ROOT') return; const ancestors = []; let currentId = categoryId; while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) { const category = categoriesMap.get(currentId); if (!category) break; ancestors.push(currentId); currentId = category.parent; }
        let virtualRootId = null; const lastOriginalAncestorId = ancestors[ancestors.length - 1]; if (categoryContainsClass(lastOriginalAncestorId, 'Machine')) virtualRootId = VIRTUAL_COMPUTER_ROOT_ID; else if (categoryContainsClass(lastOriginalAncestorId, 'User')) virtualRootId = VIRTUAL_USER_ROOT_ID;
        if(virtualRootId) ancestors.push(virtualRootId);
        ancestors.reverse().forEach(id => { const nodeLi = navTreeElement.querySelector(`li[data-category-id="${id}"]`); if (nodeLi) { const subUl = nodeLi.querySelector(':scope > ul'); const toggle = nodeLi.querySelector(':scope > div > .toggle'); if (toggle && subUl && subUl.style.display === 'none') toggleNode(toggle); } });
        const targetLi = navTreeElement.querySelector(`li[data-category-id="${categoryId}"]`); if (targetLi) targetLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Global Search and Filtering ---
    function performGlobalSearchAndUpdateState() { /* ... (keep existing) ... */
         globalSearchTerm = globalSearchInput.value.toLowerCase().trim(); matchingPolicyIds.clear(); if (globalSearchTerm !== '') { policiesMap.forEach((p, id) => { if (p.searchText?.includes(globalSearchTerm)) matchingPolicyIds.add(id); }); } applyFilters();
    }
    function applyFilters() { /* ... (keep existing logic, uses context-aware tree) ... */
        const isGlobalSearchActive = globalSearchTerm !== ''; const categoryIdsToShow = new Set(); let firstMatchingCategoryId = null; let firstMatchingContext = null; // NEW: Track context of first match
        if (isGlobalSearchActive) { const categoriesContainingMatches = new Set(); matchingPolicyIds.forEach(pId => { const p = policiesMap.get(pId); if (p?.categoryId) { categoriesContainingMatches.add(p.categoryId); if (!firstMatchingCategoryId) { firstMatchingCategoryId = p.categoryId; firstMatchingContext = p.class === 'User' ? 'User' : 'Machine'; } } }); categoriesMap.forEach((c, cId) => { if (cId !== 'ROOT' && !cId.startsWith('VIRTUAL_') && c.searchText.includes(globalSearchTerm)) { categoriesContainingMatches.add(cId); if (!firstMatchingCategoryId) { firstMatchingCategoryId = cId; /* Determine context based on content */ firstMatchingContext = categoryContainsClass(cId, 'Machine') ? 'Machine' : 'User'; } } }); categoriesContainingMatches.forEach(cId => { let currentId = cId; while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) { categoryIdsToShow.add(currentId); const cat = categoriesMap.get(currentId); currentId = cat?.parent; } }); }
        let visibleItemCount = 0; const allOriginalTreeItems = navTreeElement.querySelectorAll('li.original-category'); allOriginalTreeItems.forEach(item => { const categoryId = item.getAttribute('data-category-id'); const context = item.getAttribute('data-context'); const shouldShow = !isGlobalSearchActive || categoryIdsToShow.has(categoryId); item.style.display = shouldShow ? 'list-item' : 'none'; if(shouldShow) visibleItemCount++; const toggle = item.querySelector(':scope > div > .toggle'); const subUl = item.querySelector(':scope > ul'); if (toggle && subUl) { const shouldExpand = isGlobalSearchActive && shouldShow; subUl.style.display = shouldExpand ? 'block' : 'none'; toggle.textContent = shouldExpand ? '▼' : '▶'; toggle.classList.toggle('collapsed', !shouldExpand); toggle.classList.toggle('expanded', shouldExpand); } });
        const computerRootLi = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}"]`); const userRootLi = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_USER_ROOT_ID}"]`); if (computerRootLi) { const hasVisible = computerRootLi.querySelector('li.original-category[style*="list-item"]'); computerRootLi.style.display = (isGlobalSearchActive && !hasVisible) ? 'none' : 'list-item'; const t = computerRootLi.querySelector(':scope > div > .toggle'); if(t) t.textContent = computerRootLi.querySelector('ul[style*="block"]') ? '▼' : '▶'; } if (userRootLi) { const hasVisible = userRootLi.querySelector('li.original-category[style*="list-item"]'); userRootLi.style.display = (isGlobalSearchActive && !hasVisible) ? 'none' : 'list-item'; const t = userRootLi.querySelector(':scope > div > .toggle'); if(t) t.textContent = userRootLi.querySelector('ul[style*="block"]') ? '▼' : '▶'; }
        const noResultsMsg = navTreeElement.querySelector('.no-results-message'); if (isGlobalSearchActive && visibleItemCount === 0) { if (!noResultsMsg) { const m = document.createElement('p'); m.className = 'text-gray-500 p-4 no-results-message'; m.textContent = 'Keine Treffer.'; const u = navTreeElement.querySelector('ul'); if(u) u.after(m); else navTreeElement.appendChild(m); } } else if (noResultsMsg) { noResultsMsg.remove(); }
        // --- Update Middle Pane ---
        let categoryToDisplay = lastSelectedCategoryId; let contextToUse = lastSelectedContext;
        if (isGlobalSearchActive && (!lastSelectedCategoryId || !categoryIdsToShow.has(lastSelectedCategoryId))) {
            if (firstMatchingCategoryId && categoryIdsToShow.has(firstMatchingCategoryId)) { categoryToDisplay = firstMatchingCategoryId; contextToUse = firstMatchingContext; if (categoryToDisplay !== lastSelectedCategoryId || contextToUse !== lastSelectedContext) { const treeNodeId = `${contextToUse}_${categoryToDisplay}`; selectCategoryFromTree(treeNodeId); return; } else { categoryToDisplay = null; contextToUse = null;} } else { categoryToDisplay = null; contextToUse = null;}
            if (!categoryToDisplay) { settingsListElement.innerHTML = '<p>Passende Kategorie wählen.</p>'; settingsSearchInput.disabled = true; clearDetails(); if (lastSelectedCategoryId) { navTreeElement.querySelectorAll('.category-name.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'font-semibold')); lastSelectedCategoryId = null; lastSelectedContext = null;} }
        } if (categoryToDisplay && contextToUse) { displaySettingsList(categoryToDisplay); } else if (!isGlobalSearchActive) { const firstVirtualRoot = computerRootLi || userRootLi; const firstOriginalCatLi = firstVirtualRoot?.querySelector('li.original-category'); if (firstOriginalCatLi) { selectCategoryFromTree(firstOriginalCatLi.getAttribute('data-tree-id')); } else { settingsListElement.innerHTML = '<p>Kategorie wählen.</p>'; settingsSearchInput.disabled = true; } }
    }

    // --- Event Handlers and Initialization ---
    window.toggleNode = (element) => { /* ... (keep existing) ... */
         const li = element.closest('li'); const ul = li.querySelector(':scope > ul'); if (ul) { const collapsed = ul.style.display === 'none'; ul.style.display = collapsed ? 'block' : 'none'; element.textContent = collapsed ? '▼' : '▶'; element.classList.toggle('collapsed', !collapsed); element.classList.toggle('expanded', collapsed); }
    };

    // NEW: Handler called from the tree LI's onclick
    window.selectCategoryFromTree = (nodeTreeId) => {
        const parts = nodeTreeId.split('_');
        const context = parts[0]; // 'Machine' or 'User'
        // Join remaining parts in case category ID had underscores
        const categoryId = parts.slice(1).join('_');

        // Prevent selecting virtual roots via this method
        if (categoryId === VIRTUAL_COMPUTER_ROOT_ID || categoryId === VIRTUAL_USER_ROOT_ID) return;

        console.log(`Selecting category: ${categoryId} in context: ${context}`);

        // Avoid re-selecting the exact same node
        if (lastSelectedCategoryId === categoryId && lastSelectedContext === context) return;

        lastSelectedCategoryId = categoryId;
        lastSelectedContext = context; // Store the context!
        lastSelectedPolicyId = null; // Clear policy selection

        // Update Highlighting (find the specific LI using nodeTreeId)
        navTreeElement.querySelectorAll('.category-name.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'font-semibold'));
        const currentElement = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"] .category-name`);
        if (currentElement) {
            currentElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
        } else {
            console.warn("Could not find category tree node element:", nodeTreeId);
        }

        settingsSearchInput.value = ''; // Clear middle search
        displaySettingsList(categoryId); // Pass original category ID, context is now stored globally
        clearDetails(); // Updates URL without policy
    };


    // REVISED: selectPolicy now ensures the correct context is set
    window.selectPolicy = (policyId) => {
        console.log("Selecting policy:", policyId);
        const policy = policiesMap.get(policyId);
        if (!policy) { console.warn("Policy not found:", policyId); clearDetails(); return; }

        lastSelectedPolicyId = policyId;
        const policyCategoryId = policy.categoryId;
        // Determine the primary context (Machine preferred if Both)
        const policyContext = policy.class === 'User' ? 'User' : 'Machine';
        const nodeTreeId = `${policyContext}_${policyCategoryId}`; // Construct the likely tree node ID

        // Only update category context if the policy forces a change or none was set
        if (policyCategoryId !== lastSelectedCategoryId || policyContext !== lastSelectedContext || !lastSelectedContext) {
            console.log(`Policy selection implies context change to ${policyContext} for category ${policyCategoryId}`);
            lastSelectedCategoryId = policyCategoryId;
            lastSelectedContext = policyContext; // Set context based on policy

            // Update Tree Highlighting (find the node with matching context and category)
            navTreeElement.querySelectorAll('.category-name.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'font-semibold'));
            const categoryElement = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"] .category-name`);
            if (categoryElement) {
                categoryElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
            } else {
                 console.warn("Could not find category tree node:", nodeTreeId, "- attempting selection without context highlight");
                 // Try selecting just by category ID if context node not found (might happen during search?)
                  const fallbackElement = navTreeElement.querySelector(`li[data-category-id="${policyCategoryId}"] .category-name`);
                  if (fallbackElement) fallbackElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
            }
             // Refresh middle list ONLY if category changed (rare case)
             // Normally, clicking a policy implies the category was already selected correctly.
             // displaySettingsList(policyCategoryId);
        }

        // Highlight middle pane item
        settingsListElement.querySelectorAll('.setting-item.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'border-blue-500'));
        const currentElement = settingsListElement.querySelector(`.setting-item[data-policy-id="${policyId}"]`);
        if (currentElement) { currentElement.classList.add('selected', 'bg-blue-100', 'border-blue-500'); currentElement.focus(); }
        else { console.warn("Could not find policy list item:", policyId); }

        displayPolicyDetails(policyId); // Show details
        updateUrlHash(); // Update URL with policy
    };

    // REVISED: initialize handles URL restoration considering context
    async function initialize() {
        isInitializing = true;
        const hashParams = parseUrlHash();
        const langFromUrl = hashParams.lang;
        const policyIdFromUrl = hashParams.policy;

        const validLanguages = Array.from(languageSelect.options).map(opt => opt.value);
        let initialLang = languageSelect.value;
        if (langFromUrl && validLanguages.includes(langFromUrl)) { initialLang = langFromUrl; languageSelect.value = initialLang; }
        currentLang = initialLang;

        // Reset state before loading
        globalSearchInput.value = ''; settingsSearchInput.value = ''; globalSearchTerm = ''; matchingPolicyIds.clear();
        lastSelectedCategoryId = null; lastSelectedPolicyId = null; lastSelectedContext = null; categoryClassCache.clear();

        const data = await loadData(currentLang);
        if (!data) { isInitializing = false; return; }
        processFlatData(data);
        renderNavTree(); // Render tree first

        // --- State Restoration ---
        let categoryToSelect = null;
        let policyToSelect = null;
        let contextToSelect = null;

        if (policyIdFromUrl && policiesMap.has(policyIdFromUrl)) {
            const policy = policiesMap.get(policyIdFromUrl);
            if (policy.categoryId && categoriesMap.has(policy.categoryId)) {
                categoryToSelect = policy.categoryId;
                policyToSelect = policyIdFromUrl;
                // Determine context based on policy class (prefer Machine for Both)
                contextToSelect = policy.class === 'User' ? 'User' : 'Machine';
                console.log(`Restoring from URL: Category=${categoryToSelect}, Policy=${policyToSelect}, Context=${contextToSelect}`);
            } else { console.warn(`Policy ${policyIdFromUrl} from URL has invalid categoryId ${policy.categoryId}`); }
        }

        // Apply initial filters (usually none unless search is added to URL later)
        applyFilters(); // Apply base visibility/expansion

        // Select category/policy if restored
        if (categoryToSelect && contextToSelect) {
            const nodeTreeId = `${contextToSelect}_${categoryToSelect}`;
            // Check if the specific tree node exists before selecting
            const targetNode = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"]`);
            if(targetNode) {
                 expandToCategory(categoryToSelect); // Expand using original ID
                 // Select using the combined tree node ID
                 selectCategoryFromTree(nodeTreeId); // This sets context and category
                 if (policyToSelect) {
                     // We need to call selectPolicy again to ensure details are shown and URL updated correctly
                     selectPolicy(policyToSelect);
                 }
            } else {
                 console.warn(`Node ${nodeTreeId} not found in tree for URL restoration. Falling back.`);
                 categoryToSelect = null; // Fallback to default selection
            }
        }

        // Default selection if nothing restored from URL
        if (!categoryToSelect) {
            const firstVirtualRoot = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}"]`) || navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_USER_ROOT_ID}"]`);
            const firstOriginalCatLi = firstVirtualRoot?.querySelector('li.original-category');
            if (firstOriginalCatLi) {
                selectCategoryFromTree(firstOriginalCatLi.getAttribute('data-tree-id'));
            } else {
                settingsListElement.innerHTML = '<p>Keine Kategorien.</p>';
                settingsSearchInput.disabled = true;
                clearDetails();
            }
        }


        // Add Listeners
        globalSearchInput.removeEventListener('input', debouncedGlobalSearch); globalSearchInput.addEventListener('input', debouncedGlobalSearch);
        settingsSearchInput.removeEventListener('input', applyFiltersOnMiddleSearch); settingsSearchInput.addEventListener('input', applyFiltersOnMiddleSearch);
        languageSelect.removeEventListener('change', handleLanguageChange); languageSelect.addEventListener('change', handleLanguageChange);
        //if (navSearchInput) navSearchInput.disabled = true;

        isInitializing = false;
        // updateUrlHash() is called by selectPolicy or clearDetails during the selection process
    }

    // Handler for middle search pane input
    function applyFiltersOnMiddleSearch() {
        if (lastSelectedCategoryId) {
            displaySettingsList(lastSelectedCategoryId); // Rerender list applying filter
        }
    }

    // Language Switcher Handler
    function handleLanguageChange(event) {
        const selectedLang = event.target.value;
        // Use currentLang state variable for comparison
        if (currentLang === selectedLang) {
            console.log("Language already selected:", selectedLang);
            return; // No change needed
        }

        console.log(`Language changing to ${selectedLang}. Updating URL (preserving policy if selected) and re-initializing...`);

        // 1. Construct the new URL hash with the new language AND the current policy (if one is selected)
        const params = new URLSearchParams();
        params.set('lang', selectedLang);

        // *** Preserve the currently selected policy ID ***
        if (lastSelectedPolicyId) {
            // Check if the policy actually exists in the map (it should, but safety check)
            if(policiesMap.has(lastSelectedPolicyId)){
                 params.set('policy', lastSelectedPolicyId);
                 console.log(`Preserving selected policy: ${lastSelectedPolicyId}`);
            } else {
                 console.warn(`Policy ID ${lastSelectedPolicyId} was selected but not found in current map. Not preserving in URL.`);
                 // Clear the state variable as well if it's invalid?
                 // lastSelectedPolicyId = null;
            }
        }

        const newHash = params.toString();
        const baseUrl = window.location.pathname + window.location.search; // Base path without hash
        const newUrl = baseUrl + '#' + newHash;

        // 2. Update the URL using replaceState (doesn't trigger reload)
        if (newUrl !== window.location.href) {
            history.replaceState(null, '', newUrl);
            console.log("URL hash updated for language change:", newHash);
        }

        // 3. Call initialize. It will read the new language AND the preserved policy from the updated hash.
        initialize();
    }
    // Debounced Search Handler
    const debouncedGlobalSearch = debounce(performGlobalSearchAndUpdateState, 300);

    // Initial Load
    initialize(); // Call without lang, reads from URL or dropdown
});