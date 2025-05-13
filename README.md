# ADMX Web Viewer 🚀

**The ultimate modern replacement for legacy Group Policy search tools. Find, explore, and understand ADMX-backed Group Policies with unparalleled ease and speed.**

Tired of clunky interfaces and outdated databases from sites like `admx help`, `gpsearch`, or being redirected to malicious websites (shout-out to `getadmx`)? ADMX Web Viewer is your new go-to solution for navigating the complex world of Administrative Templates (ADMX).

Built with modern web technologies, this tool provides a fast, intuitive, and searchable interface to explore Group Policy settings from various ADMX sources, including Windows versions (like Windows 11 24H2, Windows 10) and applications like Microsoft Edge.

https://dooblpls.github.io/json-gpo/

---

## ✨ Features

*   **Blazing Fast Search:**
    *   **Global Search:** Instantly search across all policy display names, descriptions, registry keys, and value names.
    *   **Contextual Search:** Filter policies within specific categories.
*   **Intuitive Navigation:**
    *   Familiar tree-view structure mirroring the Group Policy Management Console (GPMC).
    *   Clearly separated **Computer Configuration** and **User Configuration** views.
*   **Multi-Language Support:**
    *   Easily switch between languages (e.g., English, German) for policy information. Data files are language-specific.
*   **Multiple Policy Sets:**
    *   Load and switch between different ADMX policy sets (e.g., Windows 24H2, Microsoft Edge, potentially Office 365 in the future).
    *   Define custom policy sets by providing new JSON data files.
*   **Detailed Policy Information:**
    *   **Display Name & Description:** Clearly presented.
    *   **Supported On:** OS version compatibility.
    *   **ADMX Source File:** Know where the policy originates.
    *   **Registry Details:** Full registry path, value name, type, and associated options (enabled/disabled values, dropdown choices, numeric ranges).
    *   **Presentation Elements:** Understand how the policy appears in GPMC.
    *   **Breadcrumb Path:** Easily see the full GPMC path for any selected policy.
*   **Modern & Responsive UI:**
    *   Clean, user-friendly interface built with Tailwind CSS.
    *   Works great on desktop and adapts to various screen sizes.
*   **URL Hashing for Sharability:**
    *   Current language, policy set, selected policy, and context are stored in the URL hash, allowing you to share direct links to specific policy views.
*   **Client-Side Operation:**
    *   All data processing and rendering happen in the browser after initial data load, making it incredibly fast and private.
    *   Easily self-hostable as it's just HTML, CSS, and JavaScript.
*   **Extensible Data Format:**
    *   Policies are loaded from simple JSON files, making it easy to add new policy sets or update existing ones.

---

## 🎯 Why ADMX Web Viewer?

This project aims to be the definitive, open-source, and community-driven successor to tools like:

*   `admx help`
*   `gpsearch` (Group Policy Search)
*   `getadmx` (for easily browsing ADMX file contents)
*   The need for a modern `Group Policy Central Store` browser.

It addresses the common pain points of system administrators, IT professionals, security consultants, and anyone working with Windows Group Policies:

*   Finding specific policies quickly.
*   Understanding the underlying registry settings.
*   Comparing policies across different Windows versions or applications.
*   Accessing up-to-date policy information.
*   No more issues with dead websites

---

## 🛠️ How It Works & Technology Stack

ADMX Web Viewer is a client-side single-page application (SPA).

*   **Frontend:** HTML, JavaScript (ES6+), Tailwind CSS
*   **Data:** JSON files (parsed from ADMX/ADML files using Generate-AdmxJson.ps1
*   **Core Logic:**
    *   **Data Loading & Caching:** Efficiently loads and caches policy data for the selected language and policy set.
    *   **Indexing & Search:** Policies and categories are indexed for fast searching.
    *   **Dynamic Rendering:** The UI is dynamically built and updated based on user interactions.

---

## 🚀 Getting Started / Usage

1.  **Access the Live Version:** [https://dooblpls.github.io/json-gpo/](https://dooblpls.github.io/json-gpo/)
    *   OR
2.  **Self-Hosting / Local Usage:**
    *   Clone this repository: `git clone https://github.com/dooblpls/json-gpo.git`
    *   Navigate to the project directory: `cd json-gpo`
    *   Open `index.html` in your web browser. (For local data loading to work correctly, you need to serve it via a simple local web server, e.g., using Python: `python -m http.server` or Node.js `npx serve`)

**Data Files:**

The application expects JSON data files (e.g., `24h2_en_US.json`, `edge_policies_en_US.json`) in the root directory (or a configured path). These files should contain the processed ADMX data. The structure includes:

*   `allCategories`: An array of category objects.
*   `allPolicies`: An array of policy objects.

Refer to the `POLICY_SETS` constant in `app.js` for how data files are named and associated with policy sets.

**Generate Data Files from ADMX/ADML:**
```
.\Generate-AdmxJson.ps1 -AdmxBasePath "C:\Program Files (x86)\Microsoft Group Policy\Windows 11 Sep 2024 Update (24H2)\PolicyDefinitions\" -OutputPath ".\" -Languages "en-US", "de-DE" -SetName "24h2"
```
---

## 🔧 Configuration & Extension

### Adding New Policy Sets

1.  **Prepare your Data:** Parse your ADMX/ADML files into the required JSON format.
    *   *(Optional: Link to your parser tool/script or describe the expected JSON structure in more detail in a separate `CONTRIBUTING.md` or wiki page.)*
2.  **Configure `app.js`:**
    *   Add a new entry to the `POLICY_SETS` array in `app.js`:
        ```javascript
        {
            id: 'your_set_id', // e.g., 'office_365'
            displayName: 'Your Policy Set Name', // e.g., 'Microsoft Office 365'
            isDefault: false,
            filePattern: (langCode) => `your_set_prefix_${langCode}.json` // e.g., office365_admx_en_US.json
        }
        ```
3.  **Add Data Files:** Place your generated JSON files (e.g., `your_set_prefix_en_US.json`, `your_set_prefix_de_DE.json`) in the application's root directory.

### Adding New Languages

1.  **Prepare Localized Data:** Generate JSON data files for the new language (e.g., `24h2_fr_FR.json`).
2.  **Update `index.html`:** Add an `<option>` to the `#language-select` dropdown:
    ```html
    <select id="language-select" ...>
        ...
        <option value="fr-FR">Français (FR)</option>
    </select>
    ```
3.  **(Optional) Translate UI Strings:** If necessary, update any hardcoded UI strings in `getVirtualRootName` or other parts of `app.js` to support the new language if they are not already dynamic.

---

## 🤝 Contributing

Contributions are welcome! Whether it's bug fixes, feature enhancements, adding new policy sets, or improving documentation, please feel free to:

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/your-feature-name`).
3.  Make your changes.
4.  Commit your changes (`git commit -m 'Add some feature'`).
5.  Push to the branch (`git push origin feature/your-feature-name`).
6.  Open a Pull Request.

Please ensure your code follows the existing style and that any new features are well-tested.

---

## 🛣️ Future Roadmap (Ideas)

*   [ ] **Advanced Search Syntax:** (e.g., `key:HKEY_LOCAL_MACHINE`, `class:User`)
*   [ ] **Export Policy Details:** (e.g., to CSV, JSON)
*   [ ] **Dark Mode / Theming.**
*   [ ] **Integration with a backend ADMX Parser for on-the-fly updates.**
*   [ ] **User accounts/preferences for default views.**
*   [ ] **"Compare Policies" feature between sets.**
*   [ ] **More comprehensive data for Presentation elements.**

---

## 🔑 Keywords

Group Policy, ADMX, ADML, GPO, Group Policy Object, Administrative Templates, Windows Group Policy, Microsoft Edge Policies, Registry, Policy Search, GPMC, System Administration, IT Pro, Windows Configuration, `gpedit.msc` viewer, Local Group Policy Editor, Central Store, `admx.help` alternative, `gpsearch.eu` alternative, `getadmx.com` alternative, Windows 11, Windows 10, Server 2022, Server 2019.

---

## 📜 License

This project is licensed under the [MIT License]

---

**Made with ❤️ for the SysAdmin community.**