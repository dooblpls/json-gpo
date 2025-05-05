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
    let lastSelectedCategoryId = null; // Original category ID (e.g., 'WindowsComponents')
    let lastSelectedPolicyId = null;
    // NEW: Stores 'Machine' or 'User' based on the clicked tree node (context)
    let lastSelectedContext = null;
    let categoryClassCache = new Map(); // Cache for categoryContainsClass
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
            policy: params.get('policy'),
            // *** ADDED: Read context from URL ***
            context: params.get('context') // Will be 'Machine', 'User', or null
        };
    }

    function updateUrlHash() {
        if (isInitializing) return; // Prevent updates during initial load
    
        const params = new URLSearchParams();
        if (currentLang) params.set('lang', currentLang);
    
        // Only add policy and context if a policy is actually selected
        if (lastSelectedPolicyId) {
            params.set('policy', lastSelectedPolicyId);
            // *** ADDED: Store the context when a policy is selected ***
            if (lastSelectedContext) { // Make sure context is known
                params.set('context', lastSelectedContext); // Add 'context=Machine' or 'context=User'
            }
        }
        // No need to store category in URL, policy implies it
    
        const newHash = params.toString();
        const currentPath = window.location.pathname + window.location.search; // Base path without hash
    
        // Only update if the hash part actually changes
        const currentHash = window.location.hash;
        const potentialNewHash = '#' + newHash;
        // Only update if needed to prevent unnecessary history entries if policy wasn't found etc.
        if (potentialNewHash !== currentHash) {
             // Use replaceState to avoid adding to browser history for simple view changes
             console.log(`Updating URL hash from "${currentHash}" to "${potentialNewHash}"`);
             history.replaceState(null, '', currentPath + (newHash ? potentialNewHash : ''));
        }
    }


    // --- Data Loading and Processing ---
    async function loadData(lang) {
         // Use language code directly if valid, otherwise default
         const validLangs = Array.from(languageSelect.options).map(o => o.value);
         const langToLoad = validLangs.includes(lang) ? lang : languageSelect.value; // Fallback to dropdown default
         const fileNameLang = langToLoad.replace('-', '_'); // Replace dash with underscore for filename
         try {
             console.log(`Attempting to load data for ${langToLoad} from data_${fileNameLang}.json`);
             const response = await fetch(`data_${fileNameLang}.json`);
             if (!response.ok) {
                 throw new Error(`Could not load data_${fileNameLang}.json (HTTP ${response.status})`);
             }
             const data = await response.json();
             allData[langToLoad] = data; // Store data under the language code
             console.log(`Successfully loaded data for ${langToLoad}`);
             return data;
         } catch (error) {
             console.error("Error loading data:", error);
             // Display error message to the user
             settingsListElement.innerHTML = ''; // Clear potentially old list
             navTreeElement.innerHTML = ''; // Clear potentially old tree
             detailsContentElement.innerHTML = `<p class="text-red-600 p-4">Fehler beim Laden der Daten (${fileNameLang}.json): ${error.message}</p>`;
             return null; // Indicate failure
         }
    }

    function processFlatData(data) {
         categoriesMap.clear();
         policiesMap.clear();
         if (!data?.allCategories || !data?.allPolicies) {
             console.error("Invalid data structure received", data);
             return;
         }

         // Process categories
         data.allCategories.forEach(cat => {
             // Precompute search text for categories
             cat.searchText = `${cat.displayName || ''} ${cat.id || ''}`.toLowerCase();
             categoriesMap.set(cat.id, cat);
         });

         // Process policies
         data.allPolicies.forEach(pol => {
             // Precompute search text for policies (including registry keys/values if available)
             let regSearch = '';
             if (pol.registry && typeof pol.registry === 'object') {
                 if (pol.registry.key) regSearch += `${pol.registry.key} `;
                 if (pol.registry.valueName) regSearch += `${pol.registry.valueName} `;
                 // Include registry elements data in search
                 if (pol.registry.elements?.length > 0) {
                    pol.registry.elements.forEach(el => {
                        if (el && typeof el === 'object') {
                            if (el.valueName) regSearch += `${el.valueName} `;
                            if (el.id) regSearch += `${el.id} `;
                            // Include option display names in search
                            if (el.options?.length > 0) {
                                el.options.forEach(opt => { if(opt?.display) regSearch += `${opt.display} `});
                            }
                        }
                    });
                 }
                  // Include top-level option display names
                  if (pol.registry.options?.length > 0) {
                       pol.registry.options.forEach(opt => { if(opt?.display) regSearch += `${opt.display} `});
                  }
             }
             pol.searchText = `${pol.displayName || ''} ${pol.explainText || ''} ${regSearch}`.toLowerCase().replace(/\s+/g, ' ').trim(); // Normalize spaces
             policiesMap.set(pol.id, pol);
         });
         console.log(`Processed ${categoriesMap.size} categories and ${policiesMap.size} policies.`);
    }


    // --- Navigation Tree Rendering ---

    // REVISED: Checks if category or descendants contain policies matching targetClass OR 'Both'
    function categoryContainsClass(categoryId, targetClass) {
        const cacheKey = `${categoryId}:${targetClass}`;
        if (categoryClassCache.has(cacheKey)) {
            return categoryClassCache.get(cacheKey);
        }

        const category = categoriesMap.get(categoryId);
        // Base cases: invalid category, root, or virtual roots don't contain policies directly
        if (!category || categoryId === 'ROOT' || categoryId.startsWith('VIRTUAL_')) {
            return false;
        }

        // Check direct policies
        if (Array.isArray(category.policies)) {
            for (const policyId of category.policies) {
                const policy = policiesMap.get(policyId);
                // *** Condition updated to include 'Both' ***
                if (policy && (policy.class === targetClass || policy.class === 'Both')) {
                    categoryClassCache.set(cacheKey, true);
                    return true;
                }
            }
        }

        // Check children recursively
        if (Array.isArray(category.children)) {
            for (const childId of category.children) {
                if (categoryContainsClass(childId, targetClass)) { // Recursive call
                    categoryClassCache.set(cacheKey, true);
                    return true;
                }
            }
        }

        // If neither direct policies nor children match
        categoryClassCache.set(cacheKey, false);
        return false;
    }

    // REVISED: Renders category including the context ('Machine' or 'User')
    // Returns HTML string for a single LI element and its children, or '' if not relevant for context
    function renderSingleCategoryRecursive(categoryId, context) { // Add context parameter
         const category = categoriesMap.get(categoryId);
         if (!category) {
            console.warn(`Category ${categoryId} not found in map.`);
            return ''; // Skip if category data is missing
         }

         // *** Crucial Check: Does this category *or its children* contain relevant policies for the *current context*? ***
         // This uses the updated categoryContainsClass which checks for targetClass OR 'Both'
         if (!categoryContainsClass(categoryId, context)) {
              // console.log(`Skipping category ${categoryId} (${category.displayName}) in context ${context} - no relevant policies/children.`);
             return ''; // Don't render this category LI in this specific context tree branch
         }

         // Get children, ensuring it's an array
         const childrenIds = Array.isArray(category.children) ? category.children : [];

         // Build child HTML first, passing down the context
         let childrenHtml = '';
         if (childrenIds.length > 0) {
              childrenIds.forEach(childId => {
                 // Pass context down so children are also filtered correctly
                 childrenHtml += renderSingleCategoryRecursive(childId, context);
              });
         }

         // Determine if this category LI should have a toggle (only if it has children *rendered in this context*)
         const hasVisibleChildren = childrenHtml !== '';

         // Generate unique ID for this specific node in the tree, including context
         const nodeTreeId = `${context}_${categoryId}`;

         // Build the HTML for this category's LI element
         // Add data-context and the unique data-tree-id
         let html = `<li data-tree-id="${nodeTreeId}" data-category-id="${category.id}" data-context="${context}" class="category-list-item original-category" style="display: list-item;">`; // Ensure it's visible initially
         html += `<div class="flex items-center py-1">`;

         // Add toggle span or placeholder
         if (hasVisibleChildren) {
             // Start collapsed by default, unless we implement expansion state saving
             html += `<span class="toggle collapsed mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▶</span>`;
         } else {
             html += `<span class="inline-block w-4 mr-1"></span>`; // Placeholder for alignment
         }

         // Add category name span with onclick handler using the unique nodeTreeId
         // Pass the unique nodeTreeId to selectCategoryFromTree
         html += `<span class="category-name flex-grow p-1 rounded hover:bg-gray-200 cursor-pointer" onclick="selectCategoryFromTree('${nodeTreeId}')">${category.displayName}</span>`;
         html += `</div>`;

         // Add children UL if there are any visible children
         if (hasVisibleChildren) {
             // Sub-list starts hidden (collapsed)
             html += `<ul style="display: none;">${childrenHtml}</ul>`;
         }
         html += `</li>`;

         return html;
    }

    function getVirtualRootName(type) {
        // Basic localization for virtual root names
        if (type === 'Computer') {
            return currentLang === 'de-DE' ? 'Administrative Vorlagen: Computer' : 'Administrative Templates: Computer';
        }
        if (type === 'User') {
            return currentLang === 'de-DE' ? 'Administrative Vorlagen: Benutzer' : 'Administrative Templates: User';
        }
        return 'Administrative Templates'; // Fallback
    }

    // REVISED: Renders the two main branches (Machine/User) using the context-aware recursive function
    function renderNavTree() {
        navTreeElement.innerHTML = ''; // Clear previous tree
        categoryClassCache.clear(); // Clear cache before building

        if (categoriesMap.size === 0 || !categoriesMap.has('ROOT')) {
            navTreeElement.innerHTML = '<p class="text-gray-500 p-4">Keine Kategorien zum Anzeigen.</p>';
            return;
        }

        const rootCategory = categoriesMap.get('ROOT');
        // Get the original top-level category IDs (children of the logical ROOT)
        const originalTopLevelIds = Array.isArray(rootCategory?.children) ? rootCategory.children : [];

        let computerChildrenHtml = '';
        let userChildrenHtml = '';

        // Iterate through the original top-level categories from the data
        originalTopLevelIds.forEach(catId => {
            const category = categoriesMap.get(catId);
            if (!category) return; // Skip if category data is missing

            // --- Render for 'Machine' context ---
            // The recursive function itself will check if catId or its children have 'Machine' or 'Both' policies
            computerChildrenHtml += renderSingleCategoryRecursive(catId, 'Machine'); // Pass context

            // --- Render for 'User' context ---
            // The recursive function itself will check if catId or its children have 'User' or 'Both' policies
            userChildrenHtml += renderSingleCategoryRecursive(catId, 'User');       // Pass context
        });

        // Determine if the virtual roots have any content to display
        const hasComputerChildren = computerChildrenHtml !== '';
        const hasUserChildren = userChildrenHtml !== '';

        // Start building the final HTML with a root UL
        let finalHtml = '<ul>';

        // --- Computer Virtual Root ---
        finalHtml += `<li data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}" data-context="Machine" class="category-list-item top-level-virtual">`;
        finalHtml += `<div class="flex items-center py-1 font-semibold">`;
        if (hasComputerChildren) {
             // Start expanded by default for top-level virtual roots
            finalHtml += `<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>`;
        } else {
            finalHtml += `<span class="inline-block w-4 mr-1"></span>`; // Placeholder
        }
        // No onclick for virtual roots directly
        finalHtml += `<span class="category-name flex-grow p-1 rounded">${getVirtualRootName('Computer')}</span>`;
        finalHtml += `</div>`;
        if (hasComputerChildren) {
            // Start expanded
            finalHtml += `<ul style="display: block;">${computerChildrenHtml}</ul>`;
        }
        finalHtml += `</li>`;

        // --- User Virtual Root ---
        finalHtml += `<li data-category-id="${VIRTUAL_USER_ROOT_ID}" data-context="User" class="category-list-item top-level-virtual">`;
        finalHtml += `<div class="flex items-center py-1 font-semibold">`;
        if (hasUserChildren) {
             // Start expanded
            finalHtml += `<span class="toggle expanded mr-1 text-gray-500 hover:text-black cursor-pointer" onclick="toggleNode(this)">▼</span>`;
        } else {
            finalHtml += `<span class="inline-block w-4 mr-1"></span>`; // Placeholder
        }
        finalHtml += `<span class="category-name flex-grow p-1 rounded">${getVirtualRootName('User')}</span>`;
        finalHtml += `</div>`;
        if (hasUserChildren) {
            // Start expanded
            finalHtml += `<ul style="display: block;">${userChildrenHtml}</ul>`;
        }
        finalHtml += `</li>`;

        finalHtml += '</ul>';
        navTreeElement.innerHTML = finalHtml;

        // Apply global filters (if any) AFTER the tree is rendered
        applyFilters();
    }


    // REVISED: Filters policies based on the lastSelectedContext and includes 'Both'
    function displaySettingsList(categoryId) {
        const category = categoriesMap.get(categoryId);
        settingsListElement.innerHTML = ''; // Clear previous list
        let displayedPolicyCount = 0;
        const middleSearchTerm = settingsSearchInput.value.toLowerCase().trim();
        const isGlobalSearchActive = globalSearchTerm !== '';

        // *** Use lastSelectedContext (set when clicking tree node) to filter policies! ***
        const currentContext = lastSelectedContext; // Should be 'Machine' or 'User'

        if (!currentContext) {
            // This case might happen if no category is selected yet or state is inconsistent
             console.warn("displaySettingsList called without a valid context.");
             settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Bitte zuerst eine Kategorie im Baum auswählen.</p>';
             settingsSearchInput.disabled = true;
             return;
        }

        if (category && Array.isArray(category.policies)) {
            const categoryPolicyIds = category.policies;

            // 1. Filter by global search term if active
            // Only consider policies that match the global search OR if global search is inactive
            const globallyVisiblePolicyIds = isGlobalSearchActive
                ? categoryPolicyIds.filter(id => matchingPolicyIds.has(id))
                : categoryPolicyIds;

            // 2. *** Filter by CONTEXT ('Machine'/'User' and 'Both') ***
            const contextFilteredPolicyIds = globallyVisiblePolicyIds.filter(id => {
                 const policy = policiesMap.get(id);
                 // Include if policy class matches the current context OR is 'Both'
                 return policy && (policy.class === currentContext || policy.class === 'Both');
            });

            // 3. Sort the remaining policies by display name
            const sortedPolicyIds = [...contextFilteredPolicyIds].sort((a, b) => {
                 const policyA = policiesMap.get(a);
                 const policyB = policiesMap.get(b);
                 // Handle potential missing policies gracefully in sort
                 return (policyA?.displayName || '').localeCompare(policyB?.displayName || '');
            });


            // 4. Filter by middle pane search term and render
            sortedPolicyIds.forEach(policyId => {
                const policy = policiesMap.get(policyId);
                if (policy) {
                    // Check against middle pane search term
                    if (!middleSearchTerm || policy.searchText.includes(middleSearchTerm)) {
                        const policyDiv = document.createElement('div');
                        // Added tabindex and keydown for accessibility
                        policyDiv.className = 'setting-item p-2 border-b border-l-2 border-transparent cursor-pointer hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300';
                        policyDiv.textContent = policy.displayName;
                        policyDiv.setAttribute('onclick', `selectPolicy('${policyId}')`);
                        policyDiv.setAttribute('data-policy-id', policyId);
                        policyDiv.setAttribute('tabindex', '0'); // Make it focusable
                        // Add keyboard interaction (Enter/Space to select)
                        policyDiv.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault(); // Prevent space scrolling
                                selectPolicy(policyId);
                            }
                        });
                        settingsListElement.appendChild(policyDiv);
                        displayedPolicyCount++;
                    }
                }
            });
        }

        // --- Message Handling ---
        if (displayedPolicyCount === 0) {
            if (!category) {
                // Should not happen if categoryId is valid, but as a fallback
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Kategorie nicht gefunden.</p>';
            } else if (isGlobalSearchActive || middleSearchTerm) {
                // Context added to message
                settingsListElement.innerHTML = `<p class="text-gray-500 p-4">Keine passenden Einstellungen für '${currentContext}'${middleSearchTerm ? ' für "' + middleSearchTerm + '"' : ''}${isGlobalSearchActive ? ' (und globale Suche)' : ''} gefunden.</p>`;
            } else if (!category.policies || category.policies.length === 0) {
                 settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Keine Einstellungen in dieser Kategorie definiert.</p>';
            } else {
                 // Category has policies, but none match the current context ('Machine'/'User'/'Both') after filtering
                 settingsListElement.innerHTML = `<p class="text-gray-500 p-4">Keine '${currentContext}'-relevanten Einstellungen in dieser Kategorie vorhanden.</p>`;
            }
        }

        // Enable/disable middle search input based on whether there are items *to* search
        // Disable only if the list is empty AND there's no active search term
        settingsSearchInput.disabled = (displayedPolicyCount === 0 && !middleSearchTerm);
    }


    // --- Policy Details Display ---
    // (No changes required in displayPolicyDetails itself for the 'Both' logic,
    // but registry display part was already handling 'Both' for the HKEY path)
    function displayPolicyDetails(policyId) {
        const policy = policiesMap.get(policyId);
        if (!policy) {
            clearDetails();
            return;
        }

        // Clone the template
        const detailNode = detailsPlaceholder.cloneNode(true);
        detailNode.style.display = 'block'; // Make it visible
        detailNode.removeAttribute('id'); // Avoid duplicate IDs

        // --- Populate Basic Info ---
        detailNode.querySelector('#details-title').textContent = policy.displayName || 'Unbenannte Richtlinie';
        // Combine supportedOn and admxFile if both exist
        const supportedText = policy.supportedOn ? `Unterstützt: ${policy.supportedOn}` : 'Unterstützung nicht angegeben';
        const admxText = policy.admxFile ? ` (Quelle: ${policy.admxFile})` : '';
        detailNode.querySelector('#details-supported').textContent = supportedText + admxText;

        // --- Populate Description ---
        // Basic escaping and newline conversion for description
        const explainHtml = (policy.explainText || 'Keine Beschreibung verfügbar.')
                              .replace(/&/g, '&') // Escape & first
                              .replace(/</g, '<')
                              .replace(/>/g, '>')
                              .replace(/"/g, '"')
                              .replace(/'/g, "'")
                              .replace(/\n/g, '<br>'); // Convert newline to <br>
        detailNode.querySelector('#details-description').innerHTML = explainHtml;

        // --- Populate Registry Info ---
        const registryElement = detailNode.querySelector('#details-registry');
        registryElement.innerHTML = ''; // Clear placeholder
        if (policy.registry && typeof policy.registry === 'object') { // Check registry is object
            const reg = policy.registry;
            const policyClass = policy.class; // 'Machine', 'User', 'Both'

            // Map class to Hive more robustly
            const hiveMap = {
                User: "HKEY_CURRENT_USER",
                Machine: "HKEY_LOCAL_MACHINE",
                Both: "HKEY_LOCAL_MACHINE *und* HKEY_CURRENT_USER", // Indicate both
              };
            // Display Class/Hive
            if (policyClass) {
                const classPElement = document.createElement('p');
                classPElement.innerHTML = `<strong>Bereich:</strong> ${hiveMap[policyClass] || policyClass}`; // Use mapped name or class itself
                registryElement.appendChild(classPElement);
            }

            // Display Key Path
            const keyP = document.createElement('p');
            keyP.innerHTML = `<strong>Pfad:</strong> ${reg.key || 'Nicht angegeben'}`;
            registryElement.appendChild(keyP);

            // Display top-level value information if it exists and there are no 'elements' or 'elements' is empty
            if (reg.valueName && (!reg.elements || (Array.isArray(reg.elements) && reg.elements.length === 0))) {
                const valueP = document.createElement('p');
                valueP.innerHTML = `<strong>Wertname:</strong> ${reg.valueName}`;
                registryElement.appendChild(valueP);
                const typeP = document.createElement('p');
                typeP.innerHTML = `<strong>Typ:</strong> ${reg.type === 'Unknown' ? "REG_DWORD":reg.type || "Unknown"}`; // Show type if available
                registryElement.appendChild(typeP);
                if(reg.type === 'Unknown') {
                    reg.options = [
                        {
                            "value": "1",
                            "display": "Aktiviert"
                        },
                        {
                            "value": "0",
                            "display": "Deaktiviert"
                        }
                    ]
                }
                 // Display options for the top-level value if they exist
                if (reg.options && Array.isArray(reg.options) && reg.options.length > 0) {
                    const optionsTitle = document.createElement('strong');
                    optionsTitle.textContent = 'Optionen:';
                    registryElement.appendChild(optionsTitle);
                    const optionsList = document.createElement('ul');
                    optionsList.className = 'list-disc list-inside mt-1 pl-4 text-sm'; // Indent options
                    reg.options.forEach(opt => {
                         if (opt && typeof opt === 'object') { // Check opt is a valid object
                             const item = document.createElement('li');
                             item.innerHTML = `<em>${opt.display || '?'}</em>: <code>${opt.value !== undefined ? opt.value : '?'}</code>`;
                             optionsList.appendChild(item);
                         }
                    });
                    registryElement.appendChild(optionsList);
                }
            }

            // Display 'elements' if the array exists and has items
            if (reg.elements && Array.isArray(reg.elements) && reg.elements.length > 0) {
                const elementsTitle = document.createElement('h4');
                elementsTitle.className = 'font-medium mt-3 mb-1 text-gray-800'; // Add margin top
                elementsTitle.textContent = 'Registrierungs-Elemente:';
                registryElement.appendChild(elementsTitle);

                 // Handle combined case: Add note about the main valueName if elements also exist
                 if (reg.valueName) {
                     const mainValueInfo = document.createElement('p');
                     mainValueInfo.className = 'mt-1 mb-2 text-xs italic text-gray-600';
                     const mainOptionsText = (reg.options && Array.isArray(reg.options) && reg.options.length > 0)
                                             ? ` (Optionen: ${reg.options.map(o => `${o.display || '?'}=${o.value !== undefined ? o.value : '?'}`).join(', ')})`
                                             : '';
                     mainValueInfo.innerHTML = `(Haupt-Wertname: <strong>${reg.valueName}</strong>, Typ: ${reg.type || 'Unbekannt'}${mainOptionsText})`;
                     elementsTitle.before(mainValueInfo); // Display before elements list title
                 }


                const elementsList = document.createElement('div');
                elementsList.className = 'space-y-2 ml-2 border-l-2 pl-3 border-gray-300'; // Style the elements container
                reg.elements.forEach(elem => {
                    if (elem && typeof elem === 'object') { // Check elem is a valid object
                        const elemDiv = document.createElement('div');
                        elemDiv.className = 'border-b border-dashed pb-1 mb-1 border-gray-200'; // Style each element item
                        let elemHtml = `<strong>${elem.valueName || elem.id || '?'}</strong> <span class="text-sm text-gray-600">(${elem.type || 'Unbekannt'})</span>`;

                        // Add details like min/max if they exist
                        const details = [];
                        if (elem.minValue !== null && elem.minValue !== undefined) details.push(`Min: ${elem.minValue}`);
                        if (elem.maxValue !== null && elem.maxValue !== undefined) details.push(`Max: ${elem.maxValue}`);
                        if (elem.maxLength !== null && elem.maxLength !== undefined) details.push(`Max Länge: ${elem.maxLength}`);
                        if (elem.required) details.push(`Erforderlich`);
                        if (details.length > 0) elemHtml += `, ${details.join(', ')}`;

                        elemDiv.innerHTML = elemHtml;

                        // Display options for this element if they exist
                        if (elem.options && Array.isArray(elem.options) && elem.options.length > 0) {
                            const elemOptionsTitle = document.createElement('strong');
                            elemOptionsTitle.className = 'text-xs block mt-1';
                            elemOptionsTitle.textContent = 'Optionen:';
                            elemDiv.appendChild(elemOptionsTitle);
                            const elemOptionsList = document.createElement('ul');
                            elemOptionsList.className = 'list-disc list-inside mt-0 pl-4 text-xs'; // Indent options
                            elem.options.forEach(opt => {
                                if (opt && typeof opt === 'object') { // Check opt is valid
                                    const item = document.createElement('li');
                                     item.innerHTML = `<em>${opt.display || '?'}</em>: <code>${opt.value !== undefined ? opt.value : '?'}</code>`;
                                    elemOptionsList.appendChild(item);
                                }
                            });
                            elemDiv.appendChild(elemOptionsList);
                        }
                        elementsList.appendChild(elemDiv);
                    }
                });
                registryElement.appendChild(elementsList);
            }

            // If neither top-level value nor elements exist (but registry object itself does)
            if (!reg.valueName && (!reg.elements || reg.elements.length === 0)) {
                 const noValueP = document.createElement('p');
                 noValueP.className = 'text-sm italic text-gray-500 mt-1';
                 noValueP.textContent = '(Kein spezifischer Wertname oder Elemente definiert)';
                 registryElement.appendChild(noValueP);
            }

        } else {
            // Message if no registry info at all
            registryElement.textContent = 'Keine Registrierungsinformationen verfügbar.';
        }

        // --- Populate Presentation Info ---
        const presentationContainer = detailNode.querySelector('#details-presentation-container');
        const presentationElement = detailNode.querySelector('#details-presentation');
        presentationElement.innerHTML = ''; // Clear placeholder
        // Check for presentation elements more robustly
        if (policy.presentation?.elements && Array.isArray(policy.presentation.elements) && policy.presentation.elements.length > 0) {
            policy.presentation.elements.forEach(presElem => {
                 // Check presElem is a valid object
                 if (presElem && typeof presElem === 'object') {
                     const presDiv = document.createElement('div');
                     presDiv.className = 'text-sm mb-1'; // Add margin bottom
                     // Display label or type, include refId if present
                     presDiv.innerHTML = `<strong>${presElem.label || presElem.type || '?'}</strong> <span class="text-xs text-gray-500">(${presElem.type || '?'}${presElem.refId ? `, ref: ${presElem.refId}` : ''})</span>`;
                     presentationElement.appendChild(presDiv);
                 }
            });
            presentationContainer.style.display = 'block'; // Show container
        } else {
            presentationContainer.style.display = 'none'; // Hide container if no elements
        }

        // --- Replace Placeholder with Content ---
        detailsContentElement.innerHTML = ''; // Clear previous content or placeholder message
        detailsContentElement.appendChild(detailNode);
    }

    function clearDetails() {
         detailsContentElement.innerHTML = '<h2 class="text-gray-500 p-6">Wählen Sie eine Einstellung aus der Liste aus.</h2>';
         // Clear policy state but keep category/context state
         lastSelectedPolicyId = null;
         // Deselect policy in middle pane
         settingsListElement.querySelectorAll('.setting-item.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'border-blue-500');
         });
         updateUrlHash(); // Update URL to remove policy parameter
    }

    // --- URL Expansion Helper ---
    // REVISED: Needs to expand within the correct context if possible, but primarily uses categoryId
    function expandToCategory(categoryId, targetContext = null) { // context is optional here
        if (!categoryId || categoryId.startsWith('VIRTUAL_') || categoryId === 'ROOT') return;

        console.log(`Expanding to category: ${categoryId}, preferred context: ${targetContext}`);

        const ancestors = [];
        let currentId = categoryId;
        // Traverse up the parent chain using the original category IDs
        while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) {
            const category = categoriesMap.get(currentId);
            if (!category) {
                console.warn(`Category ${currentId} not found during ancestor traversal.`);
                break; // Stop if category not found
            }
            ancestors.push(currentId);
            currentId = category.parent; // Assumes parent property exists and is correct
            if (!currentId) break; // Stop if no parent (should eventually hit ROOT)
        }

        // Determine the correct virtual root context based on the target or top ancestor
        let virtualRootContext = targetContext;
        if (!virtualRootContext) {
            // If no target context, try to infer from the category itself or its top ancestor
            const topOriginalAncestorId = ancestors.length > 0 ? ancestors[ancestors.length - 1] : categoryId;
             if (categoryContainsClass(topOriginalAncestorId, 'Machine')) {
                 virtualRootContext = 'Machine';
             } else if (categoryContainsClass(topOriginalAncestorId, 'User')) {
                 virtualRootContext = 'User';
             } else {
                  console.warn(`Cannot determine context for expansion of ${categoryId}. Defaulting to Machine.`);
                  virtualRootContext = 'Machine'; // Default if unclear
             }
        }
        const virtualRootId = virtualRootContext === 'Machine' ? VIRTUAL_COMPUTER_ROOT_ID : VIRTUAL_USER_ROOT_ID;

        // Add the virtual root to the beginning of the path to expand
        ancestors.push(virtualRootId); // Add the determined virtual root
        ancestors.reverse(); // Put in top-down order (VirtualRoot -> ... -> Target)

        console.log("Expansion path:", ancestors.map(id => `${virtualRootContext || '?'}_${id}`)); // Debug path

        // Expand each node in the path
        ancestors.forEach(idToExpand => {
            // Construct the specific nodeTreeId for this context
            const nodeTreeId = `${virtualRootContext}_${idToExpand}`;
            // Find the LI element using the unique tree ID
            const nodeLi = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"]`);
            if (nodeLi) {
                const subUl = nodeLi.querySelector(':scope > ul');
                const toggle = nodeLi.querySelector(':scope > div > .toggle');
                // If toggle exists, sub-list exists, and it's currently hidden, click the toggle
                if (toggle && subUl && subUl.style.display === 'none') {
                    toggleNode(toggle); // Use the existing toggle function
                }
            } else {
                 // If the specific node isn't found (e.g. filtered out), try finding based on category ID only as fallback
                 const fallbackNodeLi = navTreeElement.querySelector(`li[data-category-id="${idToExpand}"]`);
                  if (fallbackNodeLi) {
                     const subUl = fallbackNodeLi.querySelector(':scope > ul');
                     const toggle = fallbackNodeLi.querySelector(':scope > div > .toggle');
                     if (toggle && subUl && subUl.style.display === 'none') {
                         toggleNode(toggle);
                     }
                  } else {
                      console.warn(`Node not found for expansion: treeId=${nodeTreeId}, categoryId=${idToExpand}`);
                  }
            }
        });

        // Scroll the final target category into view
        const targetNodeTreeId = `${virtualRootContext}_${categoryId}`;
        const targetLi = navTreeElement.querySelector(`li[data-tree-id="${targetNodeTreeId}"]`);
        if (targetLi) {
            targetLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            // Fallback scroll to first instance if specific context node not found
             const fallbackTargetLi = navTreeElement.querySelector(`li[data-category-id="${categoryId}"]`);
              if(fallbackTargetLi) fallbackTargetLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }


    // --- Global Search and Filtering ---
    function performGlobalSearchAndUpdateState() {
         globalSearchTerm = globalSearchInput.value.toLowerCase().trim();
         matchingPolicyIds.clear(); // Clear previous policy matches

         if (globalSearchTerm !== '') {
             // Find matching policies
             policiesMap.forEach((policy, policyId) => {
                 if (policy.searchText?.includes(globalSearchTerm)) {
                     matchingPolicyIds.add(policyId);
                 }
             });
         }
         // Apply filters (which handles both policy and category matches)
         applyFilters();
    }

    // REVISED: applyFilters now considers context when deciding visibility and auto-selection
    function applyFilters() {
        const isGlobalSearchActive = globalSearchTerm !== '';
        const categoryIdsToShow = new Set(); // Stores original category IDs that should be visible
        let firstMatchingCategoryId = null; // Store the *original* category ID of the first match
        let firstMatchingContext = null; // Store the *context* ('Machine'/'User') of the first match

        if (isGlobalSearchActive) {
            const categoriesContainingPolicyMatches = new Set();
            // 1. Find categories containing matching policies
            matchingPolicyIds.forEach(policyId => {
                const policy = policiesMap.get(policyId);
                if (policy?.categoryId) {
                    categoriesContainingPolicyMatches.add(policy.categoryId);
                    // Store the first category found via a policy match and determine its primary context
                    if (!firstMatchingCategoryId) {
                        firstMatchingCategoryId = policy.categoryId;
                        // Prefer Machine context if policy is Machine or Both
                        firstMatchingContext = (policy.class === 'User') ? 'User' : 'Machine';
                    }
                }
            });

            // 2. Find categories whose names/IDs match the search term
            categoriesMap.forEach((category, categoryId) => {
                // Exclude ROOT and virtual roots from direct name matching
                if (categoryId !== 'ROOT' && !categoryId.startsWith('VIRTUAL_')) {
                    if (category.searchText.includes(globalSearchTerm)) {
                        categoriesContainingPolicyMatches.add(categoryId);
                        // Store the first category found via name match if none found yet
                        if (!firstMatchingCategoryId) {
                            firstMatchingCategoryId = categoryId;
                            // Determine context based on category content (prefer Machine if both exist)
                            if (categoryContainsClass(categoryId, 'Machine')) { // Checks Machine or Both
                                firstMatchingContext = 'Machine';
                            } else if (categoryContainsClass(categoryId, 'User')) { // Checks User or Both
                                firstMatchingContext = 'User';
                            } else {
                                firstMatchingContext = 'Machine'; // Default if somehow contains neither?
                            }
                        }
                    }
                }
            });

            // 3. Determine all ancestors of matching categories to ensure paths are visible
            categoriesContainingPolicyMatches.forEach(matchingCatId => {
                let currentId = matchingCatId;
                while (currentId && currentId !== 'ROOT' && !currentId.startsWith('VIRTUAL_')) {
                    categoryIdsToShow.add(currentId); // Add the category itself and its parents
                    const cat = categoriesMap.get(currentId);
                    currentId = cat?.parent;
                     if (!cat) break; // Safety break
                }
            });
        }

        // --- Apply Visibility to Tree Nodes ---
        let visibleItemCount = 0;
        // Select all original category list items (not the virtual roots)
        const allCategoryTreeLIs = navTreeElement.querySelectorAll('li.original-category');

        allCategoryTreeLIs.forEach(itemLi => {
            const categoryId = itemLi.getAttribute('data-category-id');
            // Check if this original category ID is in the set to show OR if search is inactive
            const shouldShow = !isGlobalSearchActive || categoryIdsToShow.has(categoryId);

            itemLi.style.display = shouldShow ? 'list-item' : 'none'; // Show or hide the LI

            if (shouldShow) {
                visibleItemCount++;
                // Expand nodes during active search to reveal matches
                const toggle = itemLi.querySelector(':scope > div > .toggle');
                const subUl = itemLi.querySelector(':scope > ul');
                if (toggle && subUl) {
                    // Expand if search is active AND this item is shown (meaning it or a child matched)
                    const shouldExpand = isGlobalSearchActive; // Simpler: expand all visible items during search
                    subUl.style.display = shouldExpand ? 'block' : 'none';
                    toggle.textContent = shouldExpand ? '▼' : '▶';
                    toggle.classList.toggle('collapsed', !shouldExpand);
                    toggle.classList.toggle('expanded', shouldExpand);
                }
            }
        });

        // --- Hide Virtual Roots if they have no visible children during search ---
        const computerRootLi = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}"]`);
        const userRootLi = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_USER_ROOT_ID}"]`);

        if (computerRootLi) {
            // Check if any original category LI *within this Machine branch* is visible
            const hasVisibleChildren = computerRootLi.querySelector('li.original-category[style*="list-item"]');
            computerRootLi.style.display = (isGlobalSearchActive && !hasVisibleChildren) ? 'none' : 'list-item';
            // Update toggle based on actual UL display state (which might be forced open by search)
             const compToggle = computerRootLi.querySelector(':scope > div > .toggle');
             const compUl = computerRootLi.querySelector(':scope > ul');
             if(compToggle && compUl) compToggle.textContent = compUl.style.display === 'block' ? '▼' : '▶';
        }
        if (userRootLi) {
             // Check if any original category LI *within this User branch* is visible
            const hasVisibleChildren = userRootLi.querySelector('li.original-category[style*="list-item"]');
            userRootLi.style.display = (isGlobalSearchActive && !hasVisibleChildren) ? 'none' : 'list-item';
             // Update toggle
             const userToggle = userRootLi.querySelector(':scope > div > .toggle');
             const userUl = userRootLi.querySelector(':scope > ul');
             if(userToggle && userUl) userToggle.textContent = userUl.style.display === 'block' ? '▼' : '▶';
        }

        // --- Display "No Results" Message ---
        const noResultsMsg = navTreeElement.querySelector('.no-results-message');
        if (isGlobalSearchActive && visibleItemCount === 0) {
            if (!noResultsMsg) {
                const msgElement = document.createElement('p');
                msgElement.className = 'text-gray-500 p-4 no-results-message';
                msgElement.textContent = 'Keine passenden Kategorien gefunden.';
                const rootUl = navTreeElement.querySelector('ul');
                 if(rootUl) rootUl.after(msgElement); else navTreeElement.appendChild(msgElement); // Append after UL or to parent
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove(); // Remove message if results exist or search inactive
        }

        // --- Update Middle Pane (Settings List) ---
        let categoryToDisplay = lastSelectedCategoryId; // Start with currently selected
        let contextToUse = lastSelectedContext;

        // If global search is active, we might need to change the selected category
        if (isGlobalSearchActive) {
            // If current selection is hidden OR no selection exists, try selecting the first match
            if (!lastSelectedCategoryId || !categoryIdsToShow.has(lastSelectedCategoryId)) {
                if (firstMatchingCategoryId && firstMatchingContext) {
                    // Auto-select the first matching category and context
                    categoryToDisplay = firstMatchingCategoryId;
                    contextToUse = firstMatchingContext;
                    // Construct the tree node ID to select
                    const treeNodeIdToSelect = `${contextToUse}_${categoryToDisplay}`;
                    console.log(`Global Search: Auto-selecting first match: ${treeNodeIdToSelect}`);
                    // Select the category (this updates state and calls displaySettingsList)
                    selectCategoryFromTree(treeNodeIdToSelect);
                    // We return here because selectCategoryFromTree handles the rest
                    return;
                } else {
                    // No matches found at all
                    categoryToDisplay = null;
                    contextToUse = null;
                }
            }
            // If current selection IS visible, keep it, but we still need to re-render its list
        }

        // If a category is selected (either kept or auto-selected), display its list
        if (categoryToDisplay && contextToUse) {
             // Ensure context is set (should be by now)
             lastSelectedCategoryId = categoryToDisplay;
             lastSelectedContext = contextToUse;
            displaySettingsList(categoryToDisplay); // Display list for the selected category/context
        } else if (!isGlobalSearchActive && !lastSelectedCategoryId) {
             // If search is OFF and nothing is selected (e.g., initial load failed state)
             // Do nothing, maybe show placeholder? initialize handles default selection better.
             // settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Kategorie auswählen.</p>';
             // settingsSearchInput.disabled = true;
             // clearDetails();
        } else if (!categoryToDisplay && isGlobalSearchActive) {
             // If search is ON but resulted in NO valid category to display
             settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Keine Ergebnisse für die Suche.</p>';
             settingsSearchInput.disabled = true;
             clearDetails();
             // Deselect category in tree if search yields nothing
              if (lastSelectedCategoryId) {
                  navTreeElement.querySelectorAll('.category-name.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'font-semibold'));
                  lastSelectedCategoryId = null;
                  lastSelectedContext = null;
              }
        }
        // If search is OFF and a category *was* selected, displaySettingsList was called above.
    }


    // --- Event Handlers and Initialization ---

    // Toggle for expanding/collapsing tree nodes
    window.toggleNode = (element) => {
         const li = element.closest('li'); // Find the parent LI
         if (!li) return;
         const ul = li.querySelector(':scope > ul'); // Find the direct child UL
         if (ul) {
             const isCollapsed = ul.style.display === 'none';
             ul.style.display = isCollapsed ? 'block' : 'none'; // Toggle display
             element.textContent = isCollapsed ? '▼' : '▶'; // Toggle arrow icon
             element.classList.toggle('collapsed', !isCollapsed);
             element.classList.toggle('expanded', isCollapsed);
         }
    };

    // NEW: Handler called from the tree LI's onclick, receives unique nodeTreeId
    window.selectCategoryFromTree = (nodeTreeId) => {
        if (!nodeTreeId) {
            console.warn("selectCategoryFromTree called with invalid nodeTreeId");
            return;
        }
        const parts = nodeTreeId.split('_');
        if (parts.length < 2) {
             console.warn("selectCategoryFromTree received malformed nodeTreeId:", nodeTreeId);
             return;
        }
        const context = parts[0]; // 'Machine' or 'User'
        // Join remaining parts in case category ID had underscores
        const categoryId = parts.slice(1).join('_');

        // Prevent selecting the virtual roots themselves
        if (categoryId === VIRTUAL_COMPUTER_ROOT_ID || categoryId === VIRTUAL_USER_ROOT_ID) {
             console.log("Attempted to select virtual root, ignoring.");
             return;
        }

        console.log(`Tree Click: Selecting category='${categoryId}', context='${context}' (from nodeTreeId='${nodeTreeId}')`);

        // Avoid re-processing if the exact same node is clicked again
        if (lastSelectedCategoryId === categoryId && lastSelectedContext === context) {
             console.log("Same category and context already selected.");
             return;
        }

        // --- Update State ---
        lastSelectedCategoryId = categoryId;
        lastSelectedContext = context; // Store the context!
        lastSelectedPolicyId = null; // Clear policy selection when category changes

        // --- Update UI Highlighting ---
        // Remove highlight from previously selected category name(s)
        navTreeElement.querySelectorAll('.category-name.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'font-semibold');
        });
        // Add highlight to the newly selected category name span
        const currentElement = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeId}"] .category-name`);
        if (currentElement) {
            currentElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
        } else {
            console.warn("Could not find category tree node element to highlight:", nodeTreeId);
            // Attempt fallback highlighting based on categoryId only - might highlight wrong context node
            const fallbackElement = navTreeElement.querySelector(`li[data-category-id="${categoryId}"] .category-name`);
            if (fallbackElement) fallbackElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
        }

        // --- Update Middle Pane ---
        settingsSearchInput.value = ''; // Clear middle pane search
        displaySettingsList(categoryId); // Pass original category ID, function now uses lastSelectedContext

        // --- Update Details Pane & URL ---
        clearDetails(); // Clear details and update URL (removes policy parameter)
    };


    // REVISED: selectPolicy now respects the current context when selecting a 'Both' policy
    window.selectPolicy = (policyId) => {
        console.log("Selecting policy:", policyId);
        const policy = policiesMap.get(policyId);
        if (!policy) {
             console.warn("Policy not found:", policyId);
             clearDetails();
             return;
        }

        // Avoid re-processing if the same policy is clicked again
        if (lastSelectedPolicyId === policyId) {
            console.log("Same policy already selected.");
            // Ensure details are visible even if re-clicked
            displayPolicyDetails(policyId);
            return;
        }

        // --- State Update ---
        lastSelectedPolicyId = policyId;
        const policyCategoryId = policy.categoryId;

        // *** CRITICAL CHANGE HERE ***
        // Determine the context to *use* for this selection.
        // If the policy class is 'Both', use the context the user is currently in.
        // Otherwise, use the policy's specific class ('Machine' or 'User').
        let contextForThisSelection;
        if (policy.class === 'Both') {
            // Policy applies to both, so respect the user's current navigation context
            contextForThisSelection = lastSelectedContext;
             // Safety fallback if context is somehow missing (e.g., direct URL load edge case)
             if (!contextForThisSelection) {
                 console.warn(`Policy ${policyId} is 'Both', but lastSelectedContext is missing. Defaulting context to Machine.`);
                 contextForThisSelection = 'Machine';
             }
        } else {
            // Policy is specific to Machine or User
            contextForThisSelection = policy.class; // Should be 'Machine' or 'User'
        }
        // *** END OF CRITICAL CHANGE ***

        const targetNodeTreeId = `${contextForThisSelection}_${policyCategoryId}`;

        // --- Sync Category Selection & Highlighting if Needed ---
        // Update tree selection ONLY if the category OR the context we determined
        // for *this specific selection* differs from the current state.
        if (!policyCategoryId || policyCategoryId !== lastSelectedCategoryId || contextForThisSelection !== lastSelectedContext) {
            console.log(`Policy click requires state/tree update. Target Category: ${policyCategoryId}, Target Context: ${contextForThisSelection}`);

            // Update the application's main context state
            lastSelectedCategoryId = policyCategoryId;
            lastSelectedContext = contextForThisSelection; // Set the determined context

            // Update Tree Highlighting
            navTreeElement.querySelectorAll('.category-name.selected').forEach(el => el.classList.remove('selected', 'bg-blue-100', 'font-semibold'));
            const categoryElement = navTreeElement.querySelector(`li[data-tree-id="${targetNodeTreeId}"] .category-name`);
            if (categoryElement) {
                categoryElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
                // Ensure the category node is visible and expanded
                expandToCategory(policyCategoryId, contextForThisSelection);
            } else {
                 console.warn("Could not find target category tree node for highlighting:", targetNodeTreeId);
                 // Fallback highlight based on category ID only
                  const fallbackElement = navTreeElement.querySelector(`li[data-category-id="${policyCategoryId}"] .category-name`);
                  if (fallbackElement) fallbackElement.classList.add('selected', 'bg-blue-100', 'font-semibold');
            }

             // Refresh middle list to ensure it matches the (potentially new) category/context.
             // This is important if the category or context actually changed.
             displaySettingsList(policyCategoryId);
        } else {
             console.log("Policy click within the currently selected category/context. No tree/state update needed.");
        }


        // --- Highlight Middle Pane Item ---
        settingsListElement.querySelectorAll('.setting-item.selected').forEach(el => {
            el.classList.remove('selected', 'bg-blue-100', 'border-blue-500');
        });
        const currentPolicyElement = settingsListElement.querySelector(`.setting-item[data-policy-id="${policyId}"]`);
        if (currentPolicyElement) {
            currentPolicyElement.classList.add('selected', 'bg-blue-100', 'border-blue-500');
            currentPolicyElement.focus();
            currentPolicyElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
             console.warn(`Could not find policy list item to highlight: ${policyId}.`);
        }

        // --- Show Details & Update URL ---
        displayPolicyDetails(policyId);
        updateUrlHash(); // Update URL with policy ID
    };


    // REVISED: initialize handles URL restoration considering context
    async function initialize() {
        isInitializing = true;
        console.log("Initializing application...");
    
        // --- Language and URL Params Setup ---
        const hashParams = parseUrlHash(); // Reads lang, policy, AND context
        const langFromUrl = hashParams.lang;
        const policyIdFromUrl = hashParams.policy;
        // *** Get context directly from parsed hash ***
        const contextFromUrl = hashParams.context; // This is the key addition
    
        const validLanguages = Array.from(languageSelect.options).map(opt => opt.value);
        let initialLang = languageSelect.value;
        if (langFromUrl && validLanguages.includes(langFromUrl)) {
            initialLang = langFromUrl;
            languageSelect.value = initialLang;
            console.log(`Language set from URL: ${initialLang}`);
        } else {
             console.log(`Using default/dropdown language: ${initialLang}`);
        }
        currentLang = initialLang;
    
        // --- Reset State ---
        // (Keep existing reset logic)
        globalSearchInput.value = '';
        settingsSearchInput.value = '';
        globalSearchTerm = '';
        matchingPolicyIds.clear();
        lastSelectedCategoryId = null;
        lastSelectedPolicyId = null; // Reset policy ID state
        lastSelectedContext = null;
        categoryClassCache.clear();
        navTreeElement.innerHTML = '<p class="p-4 text-gray-500">Lade Navigation...</p>';
        settingsListElement.innerHTML = '<p class="p-4 text-gray-500">Lade Einstellungen...</p>';
        clearDetails(); // Show placeholder without updating URL yet
    
        // --- Load and Process Data ---
        const data = await loadData(currentLang);
        if (!data) {
             console.error("Initialization failed: Could not load data.");
             isInitializing = false;
             return;
        }
        processFlatData(data);
    
        // --- Render Initial UI ---
        renderNavTree();
    
        // --- State Restoration from URL (Policy and Context) ---
        let categoryToSelect = null;
        let policyToSelect = null;
        let contextToSelect = null; // Context determined by policy AND **URL**
    
        if (policyIdFromUrl && policiesMap.has(policyIdFromUrl)) {
            const policy = policiesMap.get(policyIdFromUrl);
            if (policy.categoryId && categoriesMap.has(policy.categoryId)) {
                categoryToSelect = policy.categoryId;
                policyToSelect = policyIdFromUrl;
    
                // *** REVISED CONTEXT DETERMINATION LOGIC ***
                // 1. Prioritize context explicitly provided in the URL
                if (contextFromUrl === 'Machine' || contextFromUrl === 'User') {
                     contextToSelect = contextFromUrl;
                     console.log(`Restoring context directly from URL parameter: ${contextToSelect}`);
                     // Sanity check: If policy isn't 'Both', does the URL context match the policy class?
                     if (policy.class !== 'Both' && policy.class !== contextToSelect) {
                         console.warn(`URL context ('${contextFromUrl}') provided for policy ${policyIdFromUrl} mismatches its specific class ('${policy.class}'). Using URL context anyway.`);
                         // Stick with the URL context as it represents the state when copied.
                     }
                } else {
                    // 2. If no valid context in URL, determine from policy class
                    //    (Defaulting 'Both' to 'Machine' as before, but only as fallback)
                    contextToSelect = policy.class === 'User' ? 'User' : 'Machine';
                    console.log(`No valid context in URL. Determining context from policy class ('${policy.class}'): ${contextToSelect}`);
                }
                // *** END REVISED CONTEXT LOGIC ***
    
                console.log(`Attempting restore: Category=${categoryToSelect}, Policy=${policyToSelect}, Context=${contextToSelect}`);
    
            } else {
                 console.warn(`Policy ${policyIdFromUrl} from URL has invalid categoryId: ${policy.categoryId}. Cannot restore.`);
                 policyToSelect = null; // Don't try to select if category invalid
                 categoryToSelect = null;
                 contextToSelect = null;
            }
        } else if (policyIdFromUrl) {
             console.warn(`Policy ${policyIdFromUrl} from URL not found in loaded data for language ${currentLang}.`);
        }
    
        // --- Apply Initial Selection ---
        if (categoryToSelect && contextToSelect && policyToSelect) { // Make sure all needed parts are valid
            const nodeTreeIdToSelect = `${contextToSelect}_${categoryToSelect}`;
            const targetNode = navTreeElement.querySelector(`li[data-tree-id="${nodeTreeIdToSelect}"]`);
    
            if (targetNode) {
                 console.log(`Found target node ${nodeTreeIdToSelect} for URL restoration.`);
                 expandToCategory(categoryToSelect, contextToSelect);
                 // Select the category node first (sets state, updates middle pane)
                 selectCategoryFromTree(nodeTreeIdToSelect);
                 // Then select the specific policy (shows details, highlights list item, updates URL correctly now)
                 // Use a minimal timeout just in case rendering needs a cycle after category select? Often not needed.
                 // setTimeout(() => {
                     selectPolicy(policyToSelect);
                 // }, 10); // Very short delay
            } else {
                 console.warn(`Node ${nodeTreeIdToSelect} not found in tree for URL restoration. Falling back.`);
                 // Fallback to default selection if specific node missing
                 lastSelectedCategoryId = null; lastSelectedContext = null; lastSelectedPolicyId = null; // Ensure state is clear
                 selectDefaultCategory(); // Use a helper for default selection
            }
        } else {
             // --- Default Selection (if no valid policy/category/context from URL) ---
             console.log("No valid state from URL, selecting default category.");
             selectDefaultCategory(); // Use a helper for default selection
        }
    
        // --- Add Event Listeners ---
        // (Keep existing listener setup)
        const debouncedGlobalSearch = debounce(performGlobalSearchAndUpdateState, 300);
        globalSearchInput.removeEventListener('input', debouncedGlobalSearch);
        globalSearchInput.addEventListener('input', debouncedGlobalSearch);
        const debouncedMiddleSearch = debounce(applyFiltersOnMiddleSearch, 250);
        settingsSearchInput.removeEventListener('input', debouncedMiddleSearch);
        settingsSearchInput.addEventListener('input', debouncedMiddleSearch);
        languageSelect.removeEventListener('change', handleLanguageChange);
        languageSelect.addEventListener('change', handleLanguageChange);
    
        isInitializing = false; // Initialization complete
        console.log("Initialization finished.");
        // Final URL hash is now set correctly by selectPolicy/clearDetails during the selection process above
    }
    
    // Helper function for default selection (extracted from initialize)
    function selectDefaultCategory() {
        let defaultNodeToSelect = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_COMPUTER_ROOT_ID}"] li.original-category`);
        if (!defaultNodeToSelect) {
            defaultNodeToSelect = navTreeElement.querySelector(`li[data-category-id="${VIRTUAL_USER_ROOT_ID}"] li.original-category`);
        }
    
        if (defaultNodeToSelect) {
            const defaultNodeTreeId = defaultNodeToSelect.getAttribute('data-tree-id');
            console.log(`Selecting default category node: ${defaultNodeTreeId}`);
            selectCategoryFromTree(defaultNodeTreeId);
        } else {
            console.warn("No categories found to select as default.");
            settingsListElement.innerHTML = '<p class="text-gray-500 p-4">Keine Kategorien verfügbar.</p>';
            settingsSearchInput.disabled = true;
            clearDetails(); // Should already be clear, but ensure placeholder
        }
    }

    // Handler for middle search pane input - simply reruns displaySettingsList for the current category
    function applyFiltersOnMiddleSearch() {
        if (lastSelectedCategoryId && lastSelectedContext) {
             console.log("Applying middle search filter...");
             displaySettingsList(lastSelectedCategoryId); // Rerender list applying the middle search filter
             // No need to clear details when just filtering the list
        }
    }

    // Language Switcher Handler
    function handleLanguageChange(event) {
        const selectedLang = event.target.value;
        if (currentLang === selectedLang) {
            console.log("Language already selected:", selectedLang);
            return; // No change needed
        }

        console.log(`Language change requested to ${selectedLang}. Re-initializing...`);

        // Option 1: Simple Re-initialization (easier, clears state)
        // Just call initialize, which will read the new dropdown value.
        // currentLang = selectedLang; // Update state BEFORE initializing
        // initialize();

        // Option 2: Preserve Policy in URL (more user-friendly)
        // 1. Update the URL hash with the new language and the *current* policy ID
        const params = new URLSearchParams();
        params.set('lang', selectedLang);
        if (lastSelectedPolicyId) {
            // Verify policy exists before adding? Maybe not critical, initialize will handle missing policy.
            params.set('policy', lastSelectedPolicyId);
             console.log(`Preserving selected policy ${lastSelectedPolicyId} in URL for language change.`);
        } else {
             console.log("No policy selected, just changing language in URL.");
        }
        const newHash = params.toString();
        const baseUrl = window.location.pathname + window.location.search;
        const newUrl = baseUrl + '#' + newHash;

        // 2. Update the URL without triggering a page reload
        if (newUrl !== window.location.href) {
             history.replaceState(null, '', newUrl);
             console.log("URL hash updated for language change:", newHash);
        } else {
             console.log("URL already reflects the target state.");
        }


        // 3. Call initialize. It will now read the *new* language and the preserved policy ID from the hash.
        // Initialize will handle setting currentLang based on the hash/dropdown.
        initialize();
    }


    // --- Initial Load ---
    initialize(); // Start the application

});