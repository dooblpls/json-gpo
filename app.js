// --- START OF FILE app.js ---

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const navTreeElement = document.getElementById('nav-tree');
    const settingsListElement = document.getElementById('settings-list');
    const detailsContentElement = document.getElementById('details-content');
    const detailsPlaceholder = document.getElementById('details-placeholder');
    const globalSearchInput = document.getElementById('global-search');
    const settingsSearchInput = document.getElementById('settings-search');
    const languageSelect = document.getElementById('language-select');
    const policySetSelect = document.getElementById('policy-set-select');

    // --- Constants ---
    const VIRTUAL_COMPUTER_ROOT_ID = 'VIRTUAL_COMPUTER_ROOT';
    const VIRTUAL_USER_ROOT_ID = 'VIRTUAL_USER_ROOT';

    const POLICY_SETS = [
        {
            id: 'windows_24h2',
            displayName: 'Windows 24H2',
            isDefault: true,
            filePattern: (langCode) => `24h2_${langCode}.json`
        },
        {
            id: 'edge',
            displayName: 'Microsoft Edge',
            isDefault: false,
            filePattern: (langCode) => `edge_policies_${langCode}.json`
        },
    ];

    // --- State Variables ---
    let allData = {};
    let currentLang = null;
    let currentPolicySet = null;
    let categoriesMap = new Map();
    let policiesMap = new Map();
    let globalSearchTerm = '';
    let globalSearchPolicyEntries = []; 
    let isGlobalSearchActive = false;
    let lastSelectedCategoryId = null;
    let lastSelectedPolicyId = null;
    let lastSelectedContext = null;
    let categoryClassCache = new Map();
    let isInitializing = true;

    // --- Debounce Function ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- URL Hash Handling ---
    function parseUrlHash() {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        return {
            lang: params.get('lang'),
            policySet: params.get('policySet'),
            policy: params.get('policy'),
            context: params.get('context'),
        };
    }

    function updateUrlHash() {
        if (isInitializing) return;
        const params = new URLSearchParams();
        if (currentLang) params.set('lang', currentLang);
        if (currentPolicySet) params.set('policySet', currentPolicySet);

        if (lastSelectedPolicyId) { 
            params.set('policy', lastSelectedPolicyId);
            if (lastSelectedContext) {
                params.set('context', lastSelectedContext);
            }
        }

        const newHash = params.toString();
        const currentPath = window.location.pathname + window.location.search;
        const currentHash = window.location.hash;
        const potentialNewHash = '#' + newHash;
        if (potentialNewHash !== currentHash) {
            history.replaceState(null, '', currentPath + (newHash ? potentialNewHash : ''));
        }
    }

    // --- Data Loading and Processing ---
    async function loadData(policySetId, lang) {
        const selectedSet = POLICY_SETS.find(set => set.id === policySetId);
        if (!selectedSet) {
            const errorMsg = `Configuration error: Policy set '${policySetId}' is not defined.`;
            settingsListElement.innerHTML = '';
            navTreeElement.innerHTML = '';
            detailsContentElement.innerHTML = `<p class="text-red-600 p-4">${errorMsg}</p>`;
            return null;
        }
        const validLangs = Array.from(languageSelect.options).map(o => o.value);
        const langToLoad = validLangs.includes(lang) ? lang : languageSelect.value;
        const fileNameLang = langToLoad.replace('-', '_');
        const dataFileName = selectedSet.filePattern(fileNameLang);

        if (!allData[policySetId]) allData[policySetId] = {};
        if (allData[policySetId][langToLoad]) {
            return allData[policySetId][langToLoad];
        }

        try {
            const response = await fetch(dataFileName);
            if (!response.ok) throw new Error(`File not found or error (HTTP ${response.status})`);
            const data = await response.json();
            allData[policySetId][langToLoad] = data;
            return data;
        } catch (error) {
            const userMessage = `Error loading data for policy set '${selectedSet.displayName}' / language '${langToLoad}' (${dataFileName}): ${error.message}.`;
            settingsListElement.innerHTML = '';
            navTreeElement.innerHTML = '';
            detailsContentElement.innerHTML = `<p class="text-red-600 p-4">${userMessage}</p>`;
            return null;
        }
    }

    function processFlatData(data) {
         categoriesMap.clear();
         policiesMap.clear();
         if (!data?.allCategories || !data?.allPolicies) return;
         data.allCategories.forEach(cat => {
             cat.searchText = `${cat.displayName || ''} ${cat.id || ''}`.toLowerCase();
             categoriesMap.set(cat.id, cat);
         });
         data.allPolicies.forEach(pol => {
             let regSearch = '';
             if (pol.registry && typeof pol.registry === 'object') {
                 if (pol.registry.key) regSearch += `${pol.registry.key} `;
                 if (pol.registry.valueName) regSearch += `${pol.registry.valueName} `;
                 pol.registry.elements?.forEach(el => { if (el?.valueName) regSearch += `${el.valueName} `});
                 pol.registry.options?.forEach(opt => { if(opt?.display) regSearch += `${opt.display} `});
             }
             pol.searchText = `${pol.displayName || ''} ${pol.explainText || ''} ${regSearch}`.toLowerCase().replace(/\s+/g, ' ').trim();
             policiesMap.set(pol.id, pol);
         });
    }

    // --- Navigation Tree Rendering ---
    function categoryContainsClass(categoryId, targetClass) {
        const cacheKey = `${categoryId}:${targetClass}`;
        if (categoryClassCache.has(cacheKey)) return categoryClassCache.get(cacheKey);
        const category = categoriesMap.get(categoryId);
        if (!category || categoryId === 'ROOT' || categoryId.startsWith('VIRTUAL_')) return false;
        if (Array.isArray(category.policies)) {
            for (const policyId of category.policies) {
                const policy = policiesMap.get(policyId);
                if (policy && (policy.class === targetClass || policy.class === 'Both')) {
                    categoryClassCache.set(cacheKey, true); return true;
                }
            }
        }
        if (Array.isArray(category.children)) {
            for (const childId of category.children) {
                if (categoryContainsClass(childId, targetClass)) {
                    categoryClassCache.set(cacheKey, true); return true;
                }
            }
        }
        categoryClassCache.set(cacheKey, false); return false;
    }

    function renderSingleCategoryRecursive(categoryId, context) {
         const category = categoriesMap.get(categoryId);
         if (!category || !categoryContainsClass(categoryId, context)) return '';
         const childrenIds = Array.isArray(category.children) ? category.children : [];
         let childrenHtml = childrenIds.map(childId => renderSingleCategoryRecursive(childId, context)).join('');
         const hasVisibleChildren = childrenHtml !== '';
         const nodeTreeId = `${context}_${categoryId}`;
         let html = `<li data-tree-id="${nodeTreeId}" data-category-id="${category.id}" data-context="${context}" class="category-list-item original-category" style="display: list-item;">`;
         html += `<div class="flex items-center py-1">`;
         html += hasVisibleChildren ? `<span class="toggle collapsed mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▶</span>` : `<span class="inline-block w-4 mr-1"></span>`;
         html += `<span class="category-name flex-grow p-1 rounded hover:bg-gray-200 cursor-pointer" onclick="selectCategoryFromTree('${nodeTreeId}')">${category.displayName}</span>`;
         html += `</div>`;
         if (hasVisibleChildren) html += `<ul style="display: none;">${childrenHtml}</ul>`;
         html += `</li>`;
         return html;
    }

    function getVirtualRootName(type) { 
        // Use currentLang to determine the display name, default to English if lang not mapped
        const names = {
            'de-DE': {
                'Computer': 'Administrative Vorlagen: Computer',
                'User': 'Administrative Vorlagen: Benutzer'
            },
            'en-US': {
                'Computer': 'Administrative Templates: Computer',
                'User': 'Administrative Templates: User'
            }
        };
        return (names[currentLang] && names[currentLang][type]) || `Administrative Templates: ${type}`;
    }

    function renderNavTree() {
        navTreeElement.innerHTML = '';
        categoryClassCache.clear();
        if (categoriesMap.size === 0 || !categoriesMap.has('ROOT')) {
            navTreeElement.innerHTML = '<p class="text-gray-500 p-4">No categories available for this policy set.</p>';
            return;
        }
        const rootCategory = categoriesMap.get('ROOT');
        const originalTopLevelIds = Array.isArray(rootCategory?.children) ? rootCategory.children : [];
        let computerChildrenHtml = originalTopLevelIds.map(catId => renderSingleCategoryRecursive(catId, 'Machine')).join('');
        let userChildrenHtml = originalTopLevelIds.map(catId => renderSingleCategoryRecursive(catId, 'User')).join('');
        const hasComputerChildren = computerChildrenHtml !== '';
        const hasUserChildren = userChildrenHtml !== '';
        let finalHtml = '<ul>';
        finalHtml += `<li data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}" data-context="Machine" class="category-list-item top-level-virtual">
            <div class="flex items-center py-1 font-semibold">
                ${hasComputerChildren ? '<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>' : '<span class="inline-block w-4 mr-1"></span>'}
                <span class="category-name flex-grow p-1 rounded">${getVirtualRootName('Computer')}</span>
            </div>
            ${hasComputerChildren ? `<ul style="display: block;">${computerChildrenHtml}</ul>` : ''}
        </li>`;
        finalHtml += `<li data-category-id="${VIRTUAL_USER_ROOT_ID}" data-context="User" class="category-list-item top-level-virtual">
            <div class="flex items-center py-1 font-semibold">
                ${hasUserChildren ? '<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>' : '<span class="inline-block w-4 mr-1"></span>'}
                <span class="category-name flex-grow p-1 rounded">${getVirtualRootName('User')}</span>
            </div>
            ${hasUserChildren ? `<ul style="display: block;">${userChildrenHtml}</ul>` : ''}
        </li></ul>`;
        navTreeElement.innerHTML = finalHtml;
        updateNavTreeVisibilityForSearch();
    }

    // --- NEW: Function to get policy display path (breadcrumb) ---
    function getPolicyDisplayPath(policyId, displayContext) {
        if (!policyId || !displayContext) return '';

        const policy = policiesMap.get(policyId);
        if (!policy || !policy.categoryId) return '';

        let currentCatId = policy.categoryId;
        const pathSegments = [];

        while (currentCatId && currentCatId !== 'ROOT') {
            const category = categoriesMap.get(currentCatId);
            if (!category) break; // Should not happen in consistent data
            pathSegments.unshift(category.displayName); // Add to the beginning
            currentCatId = category.parent;
        }

        const virtualRootName = getVirtualRootName(displayContext);
        pathSegments.unshift(virtualRootName);

        return pathSegments.join(' > ');
    }


    // --- Settings List Display ---
    function displaySettingsList(categoryIdOrPolicyEntries, forContext = null) {
        settingsListElement.innerHTML = '';
        let displayedPolicyCount = 0;
        const middleSearchTerm = settingsSearchInput.value.toLowerCase().trim();
        const currentEffectiveContext = forContext || lastSelectedContext;

        let policiesToRender = []; 

        if (isGlobalSearchActive && Array.isArray(categoryIdOrPolicyEntries)) {
            categoryIdOrPolicyEntries.forEach(entry => {
                const policy = policiesMap.get(entry.policyId);
                if (policy) {
                    policiesToRender.push({ policy: policy, contextHint: entry.contextHint });
                }
            });
            policiesToRender.sort((a, b) => {
                const nameCompare = (a.policy.displayName || '').localeCompare(b.policy.displayName || '');
                if (nameCompare !== 0) return nameCompare;
                return (a.contextHint || '').localeCompare(b.contextHint || '');
            });

        } else if (!isGlobalSearchActive && typeof categoryIdOrPolicyEntries === 'string') {
            const categoryId = categoryIdOrPolicyEntries;
            const category = categoriesMap.get(categoryId);

            if (!currentEffectiveContext) {
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Please select a category from the tree first.</p>';
                 settingsSearchInput.disabled = true;
                 return;
            }
            if (category && Array.isArray(category.policies)) {
                category.policies.forEach(policyId => {
                    const policy = policiesMap.get(policyId);
                    if (policy && (policy.class === currentEffectiveContext || policy.class === 'Both')) {
                        policiesToRender.push({ policy: policy }); 
                    }
                });
                policiesToRender.sort((a, b) => (a.policy.displayName || '').localeCompare(b.policy.displayName || ''));
            }
        }

        policiesToRender.forEach(item => {
            const policy = item.policy;
            if (!middleSearchTerm || policy.searchText.includes(middleSearchTerm)) {
                const policyDiv = document.createElement('div');
                const divId = `policy_item_${policy.id}${item.contextHint ? '_' + item.contextHint : ''}`;
                policyDiv.id = divId;
                policyDiv.className = 'setting-item p-2 border-b border-l-2 border-transparent cursor-pointer hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300';
                
                let policyDisplayText = policy.displayName;
                let contextForOnClick = "null"; 

                if (isGlobalSearchActive && item.contextHint) {
                    policyDisplayText += ` <span class="text-xs text-gray-500">(${item.contextHint})</span>`;
                    contextForOnClick = `'${item.contextHint}'`; 
                } 

                policyDiv.innerHTML = policyDisplayText;
                policyDiv.setAttribute('onclick', `selectPolicy('${policy.id}', ${contextForOnClick})`);
                policyDiv.setAttribute('data-policy-id', policy.id);
                if (item.contextHint) {
                    policyDiv.setAttribute('data-context-hint', item.contextHint);
                }
                policyDiv.setAttribute('tabindex', '0');
                policyDiv.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectPolicy(policy.id, item.contextHint || null);
                    }
                });
                settingsListElement.appendChild(policyDiv);
                displayedPolicyCount++;
            }
        });

        if (displayedPolicyCount === 0) {
            if (isGlobalSearchActive) {
                 settingsListElement.innerHTML = `<p class="text-gray-500 p-4">No policies found for "${globalSearchTerm}"${middleSearchTerm ? ` (filtered by "${middleSearchTerm}")` : ''}.</p>`;
            } else if (typeof categoryIdOrPolicyEntries === 'string' && !categoriesMap.has(categoryIdOrPolicyEntries)) {
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Category not found.</p>';
            } else if (middleSearchTerm) {
                settingsListElement.innerHTML = `<p class="text-gray-500 p-4">No matching settings for '${currentEffectiveContext}'${middleSearchTerm ? ` for "${middleSearchTerm}"` : ''} found.</p>`;
            } else if (policiesToRender.length === 0 && typeof categoryIdOrPolicyEntries === 'string' && categoriesMap.get(categoryIdOrPolicyEntries)?.policies?.length === 0) {
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">No settings defined in this category.</p>';
            } else {
                 settingsListElement.innerHTML = `<p class="text-gray-500 p-4">No '${currentEffectiveContext}'-relevant settings in this category.</p>`;
            }
        }
        settingsSearchInput.disabled = (policiesToRender.length === 0 && !middleSearchTerm && !isGlobalSearchActive);

        if (lastSelectedPolicyId) {
            highlightPolicyInSettingsList(lastSelectedPolicyId, lastSelectedContext);
        }
    }

    // --- Policy Details Display ---
    function displayPolicyDetails(policyId) {
        const policy = policiesMap.get(policyId);
        if (!policy) { clearDetails(); return; }
        const detailNode = detailsPlaceholder.cloneNode(true);
        detailNode.style.display = 'block';
        detailNode.removeAttribute('id');

        // --- MODIFIED: Set policy path ---
        const pathElement = detailNode.querySelector('#details-path');
        if (pathElement) {
            // lastSelectedContext should be correctly set by selectPolicy before this is called
            pathElement.textContent = getPolicyDisplayPath(policyId, lastSelectedContext) || 'Path not available';
        }
        // --- END MODIFICATION ---

        detailNode.querySelector('#details-title').textContent = policy.displayName || 'Unnamed Policy';
        const supportedText = policy.supportedOn ? `Supported: ${policy.supportedOn}` : 'Support not specified';
        const admxText = policy.admxFile ? ` (Source: ${policy.admxFile})` : '';
        detailNode.querySelector('#details-supported').textContent = supportedText + admxText;
        const explainHtml = (policy.explainText || 'No description available.').replace(/\n/g, '<br>');
        detailNode.querySelector('#details-description').innerHTML = explainHtml;
        const registryElement = detailNode.querySelector('#details-registry');
        registryElement.innerHTML = '';
        if (policy.registry && typeof policy.registry === 'object') {
            const reg = policy.registry;
            const effectivePolicyContext = policy.class === 'Both' ? (lastSelectedContext || 'Machine') : policy.class;

            const hiveMap = { User: "HKEY_CURRENT_USER", Machine: "HKEY_LOCAL_MACHINE" };
            const classPElement = document.createElement('p');
            if (policy.class === 'Both') {
                classPElement.innerHTML = `<strong>Scope:</strong> ${hiveMap.Machine} *and* ${hiveMap.User} (Current view: ${effectivePolicyContext})`;
            } else {
                classPElement.innerHTML = `<strong>Scope:</strong> ${hiveMap[policy.class] || policy.class}`;
            }
            registryElement.appendChild(classPElement);
            
            const keyP = document.createElement('p');
            let regKey = reg.key || 'Not specified';
            keyP.innerHTML = `<strong>Path:</strong> ${regKey}`;
            registryElement.appendChild(keyP);

            if (reg.valueName && (!reg.elements || reg.elements.length === 0)) {
                const valueP = document.createElement('p');
                valueP.innerHTML = `<strong>Value name:</strong> ${reg.valueName}`;
                registryElement.appendChild(valueP);
                const typeP = document.createElement('p');
                typeP.innerHTML = `<strong>Type:</strong> ${reg.type === 'Unknown' ? "REG_DWORD" : reg.type || "Unknown"}`;
                registryElement.appendChild(typeP);
                if (reg.type === 'Unknown') reg.options = [{value:"1",display:"Enabled"},{value:"0",display:"Disabled"}];
                if (reg.options?.length > 0) {
                    const optionsTitle = document.createElement('strong');
                    optionsTitle.textContent = 'Options:';
                    registryElement.appendChild(optionsTitle);
                    const optionsList = document.createElement('ul');
                    optionsList.className = 'list-disc list-inside mt-1 pl-4 text-sm';
                    reg.options.forEach(opt => {
                         const item = document.createElement('li');
                         item.innerHTML = `<em>${opt.display || '?'}</em>: <code>${opt.value !== undefined ? opt.value : '?'}</code>`;
                         optionsList.appendChild(item);
                    });
                    registryElement.appendChild(optionsList);
                }
            }
            if (reg.elements?.length > 0) {
                const elementsTitle = document.createElement('h4');
                elementsTitle.className = 'font-medium mt-3 mb-1 text-gray-800';
                elementsTitle.textContent = 'Registry Elements:';
                registryElement.appendChild(elementsTitle);
                 if (reg.valueName) {
                     const mainValueInfo = document.createElement('p');
                     mainValueInfo.className = 'mt-1 mb-2 text-xs italic text-gray-600';
                     const mainOptionsText = (reg.options?.length > 0) ? ` (Options: ${reg.options.map(o => `${o.display || '?'}=${o.value !== undefined ? o.value : '?'}`).join(', ')})` : '';
                     mainValueInfo.innerHTML = `(Main value name: <strong>${reg.valueName}</strong>, Type: ${reg.type || 'Unknown'}${mainOptionsText})`;
                     elementsTitle.before(mainValueInfo);
                 }
                const elementsList = document.createElement('div');
                elementsList.className = 'space-y-2 ml-2 border-l-2 pl-3 border-gray-300';
                reg.elements.forEach(elem => {
                    const elemDiv = document.createElement('div');
                    elemDiv.className = 'border-b border-dashed pb-1 mb-1 border-gray-200';
                    let elemHtml = `<strong>${elem.valueName || elem.id || '?'}</strong> <span class="text-sm text-gray-600">(${elem.type || 'Unknown'})</span>`;
                    const details = [];
                    if (elem.minValue !== undefined) details.push(`Min: ${elem.minValue}`);
                    if (elem.maxValue !== undefined) details.push(`Max: ${elem.maxValue}`);
                    if (elem.maxLength !== undefined) details.push(`Max Length: ${elem.maxLength}`);
                    if (elem.required) details.push(`Required`);
                    if (details.length > 0) elemHtml += `, ${details.join(', ')}`;
                    elemDiv.innerHTML = elemHtml;
                    if (elem.options?.length > 0) {
                        const elemOptionsTitle = document.createElement('strong');
                        elemOptionsTitle.className = 'text-xs block mt-1';
                        elemOptionsTitle.textContent = 'Options:';
                        elemDiv.appendChild(elemOptionsTitle);
                        const elemOptionsList = document.createElement('ul');
                        elemOptionsList.className = 'list-disc list-inside mt-0 pl-4 text-xs';
                        elem.options.forEach(opt => {
                            const item = document.createElement('li');
                            item.innerHTML = `<em>${opt.display || '?'}</em>: <code>${opt.value !== undefined ? opt.value : '?'}</code>`;
                            elemOptionsList.appendChild(item);
                        });
                        elemDiv.appendChild(elemOptionsList);
                    }
                    elementsList.appendChild(elemDiv);
                });
                registryElement.appendChild(elementsList);
            }
            if (!reg.valueName && (!reg.elements || reg.elements.length === 0)) {
                 const noValueP = document.createElement('p');
                 noValueP.className = 'text-sm italic text-gray-500 mt-1';
                 noValueP.textContent = '(No specific value name or elements defined)';
                 registryElement.appendChild(noValueP);
            }
        } else {
            registryElement.textContent = 'No registry information available.';
        }
        const presentationContainer = detailNode.querySelector('#details-presentation-container');
        const presentationElement = detailNode.querySelector('#details-presentation');
        presentationElement.innerHTML = '';
        if (policy.presentation?.elements?.length > 0) {
            policy.presentation.elements.forEach(presElem => {
                 const presDiv = document.createElement('div');
                 presDiv.className = 'text-sm mb-1';
                 presDiv.innerHTML = `<strong>${presElem.label || presElem.type || '?'}</strong> <span class="text-xs text-gray-500">(${presElem.type || '?'}${presElem.refId ? `, ref: ${presElem.refId}` : ''})</span>`;
                 presentationElement.appendChild(presDiv);
            });
            presentationContainer.style.display = 'block';
        } else {
            presentationContainer.style.display = 'none';
        }
        detailsContentElement.innerHTML = '';
        detailsContentElement.appendChild(detailNode);
    }

    function clearDetails(updateHash = true) {
         detailsContentElement.innerHTML = `<h2 class="text-gray-500 p-6">Select a setting from the list.</h2>`;
         const oldPolicyId = lastSelectedPolicyId;
         lastSelectedPolicyId = null;
         
         settingsListElement.querySelectorAll('.setting-item.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'border-blue-500');
         });
         if (updateHash && oldPolicyId) updateUrlHash(); 
    }


    // --- URL Expansion Helper ---
    function expandToCategory(categoryId, targetContext = null) {
        if (!categoryId || categoryId.startsWith('VIRTUAL_') || categoryId === 'ROOT') return;
        const ancestors = [];
        let currentId = categoryId;
        while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) {
            const category = categoriesMap.get(currentId);
            if (!category) break;
            ancestors.push(currentId);
            currentId = category.parent;
            if (!currentId) break;
        }
        let virtualRootContext = targetContext;
        if (!virtualRootContext) {
            const topOriginalAncestorId = ancestors.length > 0 ? ancestors[ancestors.length - 1] : categoryId;
            virtualRootContext = categoryContainsClass(topOriginalAncestorId, 'Machine') ? 'Machine' : (categoryContainsClass(topOriginalAncestorId, 'User') ? 'User' : 'Machine');
        }
        const virtualRootId = virtualRootContext === 'Machine' ? VIRTUAL_COMPUTER_ROOT_ID : VIRTUAL_USER_ROOT_ID;
        ancestors.push(virtualRootId);
        ancestors.reverse();
        ancestors.forEach(idToExpand => {
            const nodeTreeId = `${virtualRootContext}_${idToExpand}`;
            const nodeLi = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"]`) || navTreeElement.querySelector(`li[data-category-id="${idToExpand}"][data-context="${virtualRootContext}"]`);
            if (nodeLi) {
                const subUl = nodeLi.querySelector(':scope > ul');
                const toggle = nodeLi.querySelector(':scope > div > .toggle');
                if (toggle && subUl && subUl.style.display === 'none') {
                    toggleNode(toggle, true);
                }
            }
        });
        const targetNodeTreeId = `${virtualRootContext}_${categoryId}`;
        const targetLi = navTreeElement.querySelector(`li[data-tree-id="${targetNodeTreeId}"]`);
        if (targetLi) {
            targetLi.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        }
    }

    // --- Global Search and Filtering ---
    function performGlobalSearchAndUpdateView() {
         globalSearchTerm = globalSearchInput.value.toLowerCase().trim();
         isGlobalSearchActive = globalSearchTerm !== '';
         globalSearchPolicyEntries = []; 

         if (isGlobalSearchActive) {
             policiesMap.forEach((policy, policyId) => {
                 if (policy.searchText?.includes(globalSearchTerm)) {
                     if (policy.class === 'Both') {
                         globalSearchPolicyEntries.push({ policyId: policyId, contextHint: 'Machine' });
                         globalSearchPolicyEntries.push({ policyId: policyId, contextHint: 'User' });
                     } else {
                         globalSearchPolicyEntries.push({ policyId: policyId, contextHint: policy.class });
                     }
                 }
             });
             displaySettingsList(globalSearchPolicyEntries); 
             settingsSearchInput.value = '';
             settingsSearchInput.disabled = globalSearchPolicyEntries.length === 0;

             let currentSelectionStillValid = false;
             if (lastSelectedPolicyId) {
                 const foundEntry = globalSearchPolicyEntries.find(
                     entry => entry.policyId === lastSelectedPolicyId &&
                              (policiesMap.get(lastSelectedPolicyId)?.class !== 'Both' || entry.contextHint === lastSelectedContext)
                 );
                 if (foundEntry) {
                    currentSelectionStillValid = true;
                 }
             }
             if (!currentSelectionStillValid && lastSelectedPolicyId) {
                 clearDetails();
             } else if (currentSelectionStillValid) {
                 highlightPolicyInSettingsList(lastSelectedPolicyId, lastSelectedContext); 
             }

         } else {
             if (lastSelectedCategoryId && lastSelectedContext) {
                 displaySettingsList(lastSelectedCategoryId, lastSelectedContext);
             } else {
                 selectDefaultCategory();
             }
             settingsSearchInput.disabled = !lastSelectedCategoryId;
         }
         updateNavTreeVisibilityForSearch();
    }

    function updateNavTreeVisibilityForSearch() {
        const isSearchActive = isGlobalSearchActive;
        const searchTerm = globalSearchTerm;
        const policyIdsFromSearch = new Set(globalSearchPolicyEntries.map(entry => entry.policyId));

        const categoryIdsToShow = new Set();
        if (isSearchActive) {
            const categoriesContainingPolicyMatches = new Set();
            policyIdsFromSearch.forEach(policyId => {
                const policy = policiesMap.get(policyId);
                if (policy?.categoryId) categoriesContainingPolicyMatches.add(policy.categoryId);
            });
            categoriesMap.forEach((category, categoryId) => {
                if (categoryId !== 'ROOT' && !categoryId.startsWith('VIRTUAL_')) {
                    if (category.searchText.includes(searchTerm)) {
                        categoriesContainingPolicyMatches.add(categoryId);
                    }
                }
            });
            categoriesContainingPolicyMatches.forEach(matchingCatId => {
                let currentId = matchingCatId;
                while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) {
                    categoryIdsToShow.add(currentId);
                    const cat = categoriesMap.get(currentId);
                    currentId = cat?.parent;
                    if (!cat) break;
                }
            });
        }

        let visibleItemCount = 0;
        const allCategoryTreeLIs = navTreeElement.querySelectorAll('li.original-category');
        allCategoryTreeLIs.forEach(itemLi => {
            const categoryId = itemLi.getAttribute('data-category-id');
            const shouldShow = !isSearchActive || categoryIdsToShow.has(categoryId);
            itemLi.style.display = shouldShow ? 'list-item' : 'none';
            if (shouldShow) {
                visibleItemCount++;
                const toggle = itemLi.querySelector(':scope > div > .toggle');
                const subUl = itemLi.querySelector(':scope > ul');
                if (toggle && subUl) {
                    const shouldExpand = isSearchActive && categoryIdsToShow.has(categoryId);
                    if (subUl.style.display === 'none' && shouldExpand) toggleNode(toggle, true);
                    else if (subUl.style.display === 'block' && !shouldExpand && !isNodeExpandedDueToSelection(itemLi)) toggleNode(toggle, false);
                }
            }
        });

        [VIRTUAL_COMPUTER_ROOT_ID, VIRTUAL_USER_ROOT_ID].forEach(rootId => {
            const rootLi = navTreeElement.querySelector(`li[data-category-id="${rootId}"]`);
            if (rootLi) {
                const hasVisibleChildren = rootLi.querySelector('li.original-category[style*="list-item"]');
                rootLi.style.display = (isSearchActive && !hasVisibleChildren) ? 'none' : 'list-item';
                const rootToggle = rootLi.querySelector(':scope > div > .toggle');
                const rootUl = rootLi.querySelector(':scope > ul');
                if (rootToggle && rootUl) rootToggle.textContent = rootUl.style.display === 'block' ? '▼' : '▶';
            }
        });

        const noResultsMsg = navTreeElement.querySelector('.no-results-message');
        if (isSearchActive && visibleItemCount === 0 && !noResultsMsg) {
            const msgElement = document.createElement('p');
            msgElement.className = 'text-gray-500 p-4 no-results-message';
            msgElement.textContent = 'No matching categories found.';
            const rootUl = navTreeElement.querySelector('ul');
            if (rootUl) rootUl.after(msgElement); else navTreeElement.appendChild(msgElement);
        } else if (noResultsMsg && (!isSearchActive || visibleItemCount > 0)) {
            noResultsMsg.remove();
        }
    }
    
    function isNodeExpandedDueToSelection(liElement) {
        return liElement.querySelector('.category-name.selected') !== null;
    }

    function applyFiltersOnMiddleSearch() {
        if (isGlobalSearchActive) {
            displaySettingsList(globalSearchPolicyEntries);
        } else if (lastSelectedCategoryId && lastSelectedContext) {
             displaySettingsList(lastSelectedCategoryId, lastSelectedContext);
        }
    }


    // --- Event Handlers and Initialization ---
    window.toggleNode = (element, forceExpand = null) => {
         const li = element.closest('li');
         if (!li) return;
         const ul = li.querySelector(':scope > ul');
         if (ul) {
             let isCollapsed;
             if (forceExpand === true) isCollapsed = true;
             else if (forceExpand === false) isCollapsed = false;
             else isCollapsed = ul.style.display === 'none';
             ul.style.display = isCollapsed ? 'block' : 'none';
             element.textContent = isCollapsed ? '▼' : '▶';
             element.classList.toggle('collapsed', !isCollapsed);
             element.classList.toggle('expanded', isCollapsed);
         }
    };

    window.selectCategoryFromTree = (nodeTreeId) => {
        if (!nodeTreeId) return;
        if (isGlobalSearchActive) {
            globalSearchInput.value = '';
            performGlobalSearchAndUpdateView();
        }

        const parts = nodeTreeId.split('_');
        if (parts.length < 2) return;
        const context = parts[0];
        const categoryId = parts.slice(1).join('_');
        if (categoryId === VIRTUAL_COMPUTER_ROOT_ID || categoryId === VIRTUAL_USER_ROOT_ID) return;
        if (lastSelectedCategoryId === categoryId && lastSelectedContext === context && !isGlobalSearchActive) return;

        lastSelectedCategoryId = categoryId;
        lastSelectedContext = context;

        highlightNavCategory(categoryId, context);
        settingsSearchInput.value = '';
        displaySettingsList(categoryId, context);
        
        let currentPolicyStillValid = false;
        if (lastSelectedPolicyId) {
            const policy = policiesMap.get(lastSelectedPolicyId);
            if (policy && policy.categoryId === categoryId && (policy.class === context || policy.class === 'Both')) {
                currentPolicyStillValid = true;
                highlightPolicyInSettingsList(lastSelectedPolicyId, context); 
            }
        }
        if (!currentPolicyStillValid) {
            clearDetails();
        } else {
            updateUrlHash();
        }
    };

    function highlightNavCategory(categoryId, context) {
        navTreeElement.querySelectorAll('.category-name.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'font-semibold');
        });
        const nodeTreeId = `${context}_${categoryId}`;
        const currentElement = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"] .category-name`) ||
                               navTreeElement.querySelector(`li[data-category-id="${categoryId}"][data-context="${context}"] .category-name`);
        if (currentElement) {
            currentElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
        }
    }
    
    function highlightPolicyInSettingsList(policyId, contextHintForBoth = null) {
        settingsListElement.querySelectorAll('.setting-item.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'border-blue-500');
        });

        let selector = `.setting-item[data-policy-id="${policyId}"]`;
        if (isGlobalSearchActive && policiesMap.get(policyId)?.class === 'Both' && contextHintForBoth) {
            selector += `[data-context-hint="${contextHintForBoth}"]`;
        }
        
        const currentPolicyElement = settingsListElement.querySelector(selector);
        if (currentPolicyElement) {
            currentPolicyElement.classList.add('selected', 'bg-blue-100', 'border-blue-500');
        }
    }

    window.selectPolicy = (policyId, explicitContext = null) => {
        const policy = policiesMap.get(policyId);
        if (!policy) { clearDetails(); return; }

        const oldPolicyId = lastSelectedPolicyId;
        const oldContext = lastSelectedContext;

        lastSelectedPolicyId = policyId;

        if (explicitContext) { 
            lastSelectedContext = explicitContext;
        } else if (policy.class === 'Both') {
            lastSelectedContext = lastSelectedContext || 'Machine';
        } else { 
            lastSelectedContext = policy.class;
        }
        
        displayPolicyDetails(policyId); // This will now also set the path

        if (policy.categoryId) {
            expandToCategory(policy.categoryId, lastSelectedContext); 
            highlightNavCategory(policy.categoryId, lastSelectedContext);
            if (!isGlobalSearchActive && (policy.categoryId !== lastSelectedCategoryId || lastSelectedContext !== oldContext)) {
                lastSelectedCategoryId = policy.categoryId; 
                displaySettingsList(policy.categoryId, lastSelectedContext);
            }
        }
        
        highlightPolicyInSettingsList(policyId, lastSelectedContext); 

        if (oldPolicyId !== policyId || oldContext !== lastSelectedContext) {
            updateUrlHash();
        }
    };

    function populatePolicySetSelector() {
        policySetSelect.innerHTML = '';
        POLICY_SETS.forEach(set => {
            const option = document.createElement('option');
            option.value = set.id;
            option.textContent = set.displayName;
            policySetSelect.appendChild(option);
        });
    }

    async function initialize() {
        isInitializing = true;
        populatePolicySetSelector();

        const hashParams = parseUrlHash();
        const langFromUrl = hashParams.lang;
        const policySetFromUrl = hashParams.policySet;
        const policyIdFromUrl = hashParams.policy;
        const contextFromUrl = hashParams.context;

        const validLanguages = Array.from(languageSelect.options).map(opt => opt.value);
        currentLang = (langFromUrl && validLanguages.includes(langFromUrl)) ? langFromUrl : languageSelect.value;
        languageSelect.value = currentLang;

        const defaultPolicySet = POLICY_SETS.find(ps => ps.isDefault) || POLICY_SETS[0];
        if (!defaultPolicySet) {
            detailsContentElement.innerHTML = '<p class="text-red-600 p-4">Error: No policy sets configured.</p>';
            isInitializing = false; return;
        }
        currentPolicySet = (policySetFromUrl && POLICY_SETS.find(ps => ps.id === policySetFromUrl)) ? policySetFromUrl : defaultPolicySet.id;
        policySetSelect.value = currentPolicySet;
        
        allData = {};
        globalSearchPolicyEntries = [];
        lastSelectedCategoryId = null;
        lastSelectedPolicyId = null;
        lastSelectedContext = null;
        categoryClassCache.clear();
        navTreeElement.innerHTML = '<p class="p-4 text-gray-500">Loading navigation...</p>';
        settingsListElement.innerHTML = '<p class="p-4 text-gray-500">Loading settings...</p>';
        clearDetails(false);

        const data = await loadData(currentPolicySet, currentLang);
        if (!data) { isInitializing = false; return; }
        processFlatData(data);
        renderNavTree(); // Also updates nav tree visibility based on language

        let restoredFromUrlPolicy = false;
        if (policyIdFromUrl && policiesMap.has(policyIdFromUrl)) {
            const policy = policiesMap.get(policyIdFromUrl);
            if (policy.categoryId && categoriesMap.has(policy.categoryId)) {
                const effectiveContextForSelection = contextFromUrl || (policy.class === 'User' ? 'User' : (policy.class === 'Both' ? 'Machine' : policy.class));
                isGlobalSearchActive = false; 
                globalSearchInput.value = ''; 

                selectCategoryFromTree(`${effectiveContextForSelection}_${policy.categoryId}`);
                selectPolicy(policyIdFromUrl, effectiveContextForSelection); 
                restoredFromUrlPolicy = true;
            }
        }

        if (!restoredFromUrlPolicy) {
            selectDefaultCategory();
        }

        const debouncedGlobalSearch = debounce(performGlobalSearchAndUpdateView, 300);
        globalSearchInput.removeEventListener('input', debouncedGlobalSearch);
        globalSearchInput.addEventListener('input', debouncedGlobalSearch);

        const debouncedMiddleSearch = debounce(applyFiltersOnMiddleSearch, 250);
        settingsSearchInput.removeEventListener('input', debouncedMiddleSearch);
        settingsSearchInput.addEventListener('input', debouncedMiddleSearch);

        languageSelect.removeEventListener('change', handleLanguageChange);
        languageSelect.addEventListener('change', handleLanguageChange);
        policySetSelect.removeEventListener('change', handlePolicySetChange);
        policySetSelect.addEventListener('change', handlePolicySetChange);

        isInitializing = false;
        if (!restoredFromUrlPolicy) updateUrlHash();
    }

    function selectDefaultCategory() {
        let defaultNodeToSelect = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}"] li.original-category`);
        if (!defaultNodeToSelect) {
            defaultNodeToSelect = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_USER_ROOT_ID}"] li.original-category`);
        }

        if (defaultNodeToSelect) {
            const defaultNodeTreeId = defaultNodeToSelect.getAttribute('data-tree-id');
            selectCategoryFromTree(defaultNodeTreeId);
        } else {
            if (categoriesMap.size > 0 && categoriesMap.has('ROOT')) {
                 settingsListElement.innerHTML = `<p class="text-gray-500 p-4">No categories available in the policy set ('${currentPolicySet}').</p>`;
            }
            settingsSearchInput.disabled = true;
            clearDetails();
        }
    }

    function handleLanguageChange(event) {
        const selectedLang = event.target.value;
        if (currentLang === selectedLang) return;
        
        // Update currentLang immediately for getVirtualRootName used during re-render
        currentLang = selectedLang; 

        const params = new URLSearchParams();
        params.set('lang', selectedLang);
        if (currentPolicySet) params.set('policySet', currentPolicySet);
        if (lastSelectedPolicyId) {
             params.set('policy', lastSelectedPolicyId);
             if (lastSelectedContext) params.set('context', lastSelectedContext);
        }
        history.replaceState(null, '', window.location.pathname + window.location.search + (params.toString() ? '#' + params.toString() : ''));
		isGlobalSearchActive = false;
        initialize(); // Re-initialize will use the new currentLang
    }

    function handlePolicySetChange(event) {
        const selectedPolicySetId = event.target.value;
        if (currentPolicySet === selectedPolicySetId) return;
        const params = new URLSearchParams();
        if (currentLang) params.set('lang', currentLang);
        params.set('policySet', selectedPolicySetId);
        history.replaceState(null, '', window.location.pathname + window.location.search + (params.toString() ? '#' + params.toString() : ''));
        initialize();
    }

    initialize();
});
// --- END OF FILE app.js ---