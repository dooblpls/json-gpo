<#
.SYNOPSIS
    Generates JSON data files from ADMX/ADML policy definition files
    for use in a web viewer.

.DESCRIPTION
    Reads ADMX files from a base directory and corresponding ADML files
    from language-specific subdirectories (e.g., en-US, de-DE).
    It parses the XML, resolves string references, and extracts category,
    policy, registry, and presentation information.
    Outputs one JSON file per language with flat lists of categories and policies.

.PARAMETER AdmxBasePath
    The path to the base directory containing ADMX files and language subfolders (e.g., "C:\Windows\PolicyDefinitions").

.PARAMETER OutputPath
    The path to the directory where the generated JSON files will be saved.

.PARAMETER Languages
    An array of language codes (matching the folder names) to process (e.g., @("en-US", "de-DE")).

.PARAMETER Depth
    The maximum depth for ConvertTo-Json serialization. Default is 15.

.EXAMPLE
    .\Generate-AdmxJson.ps1 -AdmxBasePath "C:\Windows\PolicyDefinitions" -OutputPath ".\data" -Languages @("en-US", "de-DE")

.NOTES
    Author: AI Assistant based on user request
    Date:   2023-10-27
    Requires PowerShell 5.1 or later.
    Ensure the script has read access to the AdmxBasePath and write access to the OutputPath.
    Namespace resolution for cross-ADMX references is simplified.
    Error handling is basic. Complex ADMX/ADML structures might require script adjustments.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$AdmxBasePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string[]]$Languages,

    [int]$Depth = 15
)

#region Helper Functions

# Helper to resolve $(string.XYZ) references
function Resolve-String {
    param(
        [string]$RawString,
        [hashtable]$StringTable,
        [string]$DefaultValue = $null
    )
    if ($RawString -match '^\$\(string\.(.+)\)$') {
        $stringId = $Matches[1]
        # Handle potential empty strings from ADML explicitly
        if ($StringTable.ContainsKey($stringId)) {
             return $StringTable[$stringId]
        } else {
            Write-Verbose "String ID not found: $stringId. Using Raw: '$RawString'"
            if ($null -ne $DefaultValue) {
                return $DefaultValue
            } else {
                return $RawString # Return raw string like $(string.XYZ) if no default and not found
            }
        }
    }
    if($RawString -like "windows:SUPPORTED_*") {
        # Handle special case for SUPPORTED_ strings
        $stringId = $RawString -replace 'windows:', ''
        if ($StringTable.ContainsKey($stringId)) {
            return $StringTable[$stringId]
        } else {
            Write-Verbose "SupportedOn string ID not found: $stringId. Using Raw: '$RawString'"
            return $RawString # Return raw string if not found
        }
    }
    # If not a $(string...) pattern, return the raw string as-is
    return $RawString # Return as-is if not a $(string...) pattern
}

# Helper to parse presentation elements (simplified)
function Parse-PresentationNode {
    param(
        [System.Xml.XmlElement]$Node,
        [hashtable]$StringTable
    )
    $presentationData = [PSCustomObject]@{
        id = $Node.id
        elements = [System.Collections.Generic.List[object]]::new()
    }
    # Iterate through known presentation element types
    foreach ($childNode in $Node.ChildNodes) {
        $elemData = [PSCustomObject]@{
            type = $childNode.LocalName # e.g., dropdownList, textBox, decimalTextBox, checkBox
            refId = $childNode.refId   # Reference to the element in the policy
            label = $null
            default = $null
            # Add more properties as needed (e.g., minValue, maxValue for decimal)
        }
        # Try to get label text (might be direct text or child node)
# Try to get label text (might be direct text or child node) - SAFE ACCESS
$labelText = $null # Initialize to null
# Check for direct text first
if ($childNode.'#text' -ne $null) {
     # Use .Value instead of .Trim() directly on #text node if it exists
     $directText = $childNode.'#text'.Value
     if ($directText -ne $null) { # Check if the value itself isn't null/empty after getting it
          $labelText = $directText.Trim()
     }
}
# If no direct text, check for a label child
if ($null -eq $labelText -and $childNode.label -ne $null -and $childNode.label.'#text' -ne $null) {
     $labelNodeText = $childNode.label.'#text'.Value
     if ($labelNodeText -ne $null) {
         $labelText = $labelNodeText.Trim()
     }
}

# Only resolve if we actually found some non-empty text
if (-not [string]::IsNullOrWhiteSpace($labelText)) {
    $elemData.label = Resolve-String -RawString $labelText -StringTable $StringTable -DefaultValue $labelText
} else {
     # Assign null or a default if no meaningful label found
     $elemData.label = $null
}
# --- END SAFE ACCESS ---

        # Add default value if present
        if ($childNode.HasAttribute('defaultValue')) {
             $elemData.default = $childNode.defaultValue
        }

        $presentationData.elements.Add($elemData)
    }

    return $presentationData
}

# Helper to process registry information from a policy node
function Process-RegistryInfo {
    param(
        [System.Xml.XmlElement]$PolicyNode,
        [hashtable]$StringTable # Needed for enum items
    )
    $regInfo = [PSCustomObject]@{
        key = $PolicyNode.key
        valueName = $null
        type = 'Unknown'
        enabledValue = $null
        disabledValue = $null
        options = $null # For enums/booleans
        elements = $null # For complex policies
    }

    # Simple policy (often Boolean) - Check existence before accessing nested properties
    if ($PolicyNode.valueName) {
        $regInfo.valueName = $PolicyNode.valueName

        # --- MORE ROBUST CHECKS ---
        $enabledDecimalValue = $null
        $disabledDecimalValue = $null

        # Check if enabledValue and its decimal child exist before accessing .value
        if ($PolicyNode.enabledValue -ne $null -and $PolicyNode.enabledValue.decimal -ne $null) {
            $enabledDecimalValue = $PolicyNode.enabledValue.decimal.value
        }
        # Check if disabledValue and its decimal child exist before accessing .value
        if ($PolicyNode.disabledValue -ne $null -and $PolicyNode.disabledValue.decimal -ne $null) {
            $disabledDecimalValue = $PolicyNode.disabledValue.decimal.value
        }

        # Only proceed if both values were found
        if ($enabledDecimalValue -ne $null -and $disabledDecimalValue -ne $null) {
            $regInfo.type = 'REG_DWORD' # Common for boolean policies
            $regInfo.enabledValue = $enabledDecimalValue
            $regInfo.disabledValue = $disabledDecimalValue

            # Initialize options list safely
            $optionsList = [System.Collections.Generic.List[object]]::new()
            $optionsList.Add([PSCustomObject]@{ value = $regInfo.enabledValue; display = (Resolve-String -RawString '$(string.Enabled)' -StringTable $StringTable -DefaultValue 'Enabled') })
            $optionsList.Add([PSCustomObject]@{ value = $regInfo.disabledValue; display = (Resolve-String -RawString '$(string.Disabled)' -StringTable $StringTable -DefaultValue 'Disabled') })
            $regInfo.options = $optionsList

        } elseif ($PolicyNode.enabledValue -ne $null -or $PolicyNode.disabledValue -ne $null) {
             # If one exists but not the other or structure is wrong, log it.
             Write-Verbose "Policy '$($PolicyNode.name)' has valueName but incomplete/missing enabledValue/disabledValue decimal structures. Type is Unknown."
             # Let type remain 'Unknown'
        } else {
            # If neither enabledValue nor disabledValue exists, it might be a simple value policy without elements.
            # ADMX doesn't usually specify type directly here. We might infer from presentation if needed, but 'Unknown' is safer.
             Write-Verbose "Policy '$($PolicyNode.name)' has valueName but no enabledValue/disabledValue elements. Type is Unknown."
        }
        # --- END ROBUST CHECKS ---
    }

    # Complex policy with <elements>
    if ($PolicyNode.elements) {
        # Initialize with a resizable list
        $elementList = [System.Collections.Generic.List[object]]::new()

        # Check if elements node actually has children
        if ($PolicyNode.elements.HasChildNodes) {
            foreach ($element in $PolicyNode.elements.ChildNodes) {
                # Create element info object first
                $elemInfo = [PSCustomObject]@{
                    id = $element.id
                    valueName = $element.valueName
                    type = 'Unknown'
                    options = $null
                    minValue = if($element.HasAttribute('minValue')) { $element.minValue } else { $null }
                    maxValue = if($element.HasAttribute('maxValue')) { $element.maxValue } else { $null }
                    maxLength = if($element.HasAttribute('maxLength')) { $element.maxLength } else { $null }
                    required = if($element.HasAttribute('required')) { [System.Convert]::ToBoolean($element.required) } else { $false }
                }

                # Determine type and options based on element type
                switch ($element.LocalName) {
                    'enum' {
                        $elemInfo.type = 'REG_DWORD' # Enum is typically DWORD
                        $elemOptionsList = [System.Collections.Generic.List[object]]::new()
                        foreach ($item in $element.item) {
                            $display = Resolve-String -RawString $item.displayName -StringTable $StringTable -DefaultValue $item.displayName
                            # --- MORE ROBUST CHECKS ---
                            $decimalValue = $null
                            # Check if item.value and item.value.decimal exist before accessing .value
                            if ($item.value -ne $null -and $item.value.decimal -ne $null) {
                                $decimalValue = $item.value.decimal.value
                            }

                            if ($decimalValue -ne $null) {
                                 $elemOptionsList.Add([PSCustomObject]@{ value = [int]$decimalValue; display = $display })
                            } else {
                                 Write-Warning "Enum item '$display' for element '$($element.id)' in policy '$($PolicyNode.name)' is missing a decimal value structure."
                            }
                            # --- END ROBUST CHECKS ---
                        }
                        if ($elemOptionsList.Count -gt 0) {
                             $elemInfo.options = $elemOptionsList
                        }
                    }
                    'decimal' { $elemInfo.type = 'REG_DWORD' }
                    'text' { $elemInfo.type = 'REG_SZ' }
                    'boolean' {
                        $elemInfo.type = 'REG_DWORD'
                        # Booleans in elements often map 0/1. Get true/false text if available.
                        # Assuming standard 1=true, 0=false if not specified via value nodes
                         $trueValue = 1
                         $falseValue = 0
                         # Could add checks for explicit trueValue/falseValue nodes if needed

                        $boolOptionsList = [System.Collections.Generic.List[object]]::new()
                        $boolOptionsList.Add([PSCustomObject]@{ value = $trueValue; display = (Resolve-String -RawString '$(string.True)' -StringTable $StringTable -DefaultValue 'True') })
                        $boolOptionsList.Add([PSCustomObject]@{ value = $falseValue; display = (Resolve-String -RawString '$(string.False)' -StringTable $StringTable -DefaultValue 'False') })
                        $elemInfo.options = $boolOptionsList
                    }
                    'multiText' { $elemInfo.type = 'REG_MULTI_SZ' }
                    'list' {
                         $elemInfo.type = 'REG_SZ' # Or REG_MULTI_SZ depending on implementation, requires careful checking
                         Write-Warning "Registry representation for 'list' element type for '$($elemInfo.valueName)' requires specific handling based on ADMX pattern."
                    }
                    default { Write-Warning "Unsupported element type '$($element.LocalName)' found in policy '$($PolicyNode.name)'." }
                }
                 $elementList.Add($elemInfo) # Add the processed element info
            } # End foreach $element
        } # End if $PolicyNode.elements.HasChildNodes

         # Store elements if there are any
         if ($elementList.Count -gt 0) {
            $regInfo.elements = $elementList
         }

         # Handle potential ambiguity if both top-level valueName AND elements exist
         if ($PolicyNode.valueName -and $regInfo.elements) {
            Write-Warning "Policy '$($PolicyNode.name)' has both a top-level 'valueName' and 'elements'. Registry information might be complex."
            # Keep both pieces of info; let the frontend decide how to display.
            # Ensure the top-level type is still set correctly if it was determined.
            if($regInfo.type -eq 'Unknown' -and $regInfo.enabledValue -ne $null) {
                 $regInfo.type = 'REG_DWORD' # Re-set if needed
            }
         }
    } # End if ($PolicyNode.elements)


    # Handle policies without valueName and without elements
    if (-not $PolicyNode.valueName -and -not $PolicyNode.elements) {
         Write-Verbose "Policy '$($PolicyNode.name)' has no 'valueName' or 'elements'. It might be a grouping or incomplete."
         # Keep Key, but other fields are null/unknown
    }


    # Cleanup null properties before returning for cleaner JSON
    $propsToRemove = $regInfo.PSObject.Properties | Where-Object { $null -eq $_.Value } | Select-Object -ExpandProperty Name
    foreach ($prop in $propsToRemove) {
        $regInfo.PSObject.Properties.Remove($prop)
    }

    return $regInfo
}

# Helper to process SupportedOn info
function Process-SupportedOn {
    param(
        [System.Xml.XmlElement]$PolicyNode,
        [hashtable]$AdmxSupportedOnDefinitions # Pre-parsed definitions from all ADMX files
    )
    if (-not $PolicyNode.supportedOn) { return "Not specified" }

    $refId = $PolicyNode.supportedOn.ref
    if ($AdmxSupportedOnDefinitions.ContainsKey($refId)) {
        # Return the display name associated with the definition ID
        # The display name itself might be a $(string.XYZ) that needs later resolution
        return $AdmxSupportedOnDefinitions[$refId].RawDisplayName
    } else {
        Write-Warning "SupportedOn reference '$refId' not found for policy '$($PolicyNode.name)'."
        return $refId # Return the raw reference if not found
    }
}

# Helper function to build a lookup for namespace prefixes
function Get-NamespacePrefixMap {
    param (
        [System.Xml.XmlElement]$PolicyDefinitionsNode
    )
    $prefixMap = @{}
    if ($PolicyDefinitionsNode.policyNamespaces) {
        # Target namespace
        $targetNs = $PolicyDefinitionsNode.policyNamespaces.target
        if ($targetNs) {
             $prefixMap[$targetNs.prefix] = $targetNs.namespace
        }
        # Using namespaces
        $PolicyDefinitionsNode.policyNamespaces.using | ForEach-Object {
            $prefixMap[$_.prefix] = $_.namespace
        }
    }
    # Add default empty prefix mapping if needed (though ADMX usually uses prefixes)
    # $prefixMap[''] = $targetNamespaceUri # Or default namespace if declared differently

    return $prefixMap
}

# Helper function to resolve a potentially prefixed name (e.g., "windows:System")
function Resolve-PrefixedName {
    param(
        [string]$PrefixedName,
        [hashtable]$NamespacePrefixMap, # Map prefix -> namespace URI
        [string]$DefaultNamespaceUri    # Namespace URI if no prefix is present
    )
    if ($PrefixedName -match '^([a-zA-Z0-9]+):(.+)$') {
        $prefix = $Matches[1]
        $name = $Matches[2]
        if ($NamespacePrefixMap.ContainsKey($prefix)) {
            $namespaceUri = $NamespacePrefixMap[$prefix]
            # Return a unique key combining namespace and name
            return "$($namespaceUri)::$($name)"
        } else {
            Write-Warning "Namespace prefix '$prefix' in '$PrefixedName' not found in prefix map."
            # Fallback or error handling - return as is?
            return $PrefixedName
        }
    } else {
        # No prefix, assume default namespace
        return "$($DefaultNamespaceUri)::$($PrefixedName)"
    }
}

#endregion Helper Functions

# --- Main Script Logic ---

Write-Host "Starting ADMX/ADML JSON Generation..."
Write-Host "ADMX Base Path: $AdmxBasePath"
Write-Host "Output Path: $OutputPath"
Write-Host "Languages: $($Languages -join ', ')"

# Create output directory if it doesn't exist
if (-not (Test-Path -Path $OutputPath -PathType Container)) {
    Write-Host "Creating output directory: $OutputPath"
    New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
}

# --- Step 1: Collect data from all ADMX files ---
Write-Host "Step 1: Parsing all ADMX files..."
$allCategories = @{} # Key: Unique ID (e.g., NamespaceUri::CategoryName), Value: PSCustomObject
$allPolicies = @{}   # Key: Unique ID (e.g., NamespaceUri::PolicyName), Value: PSCustomObject
$allPresentations = @{} # Key: Unique ID (e.g., NamespaceUri::PresentationID), Value: Raw XML Element
$admxSupportedOnDefinitions = @{} # Key: Definition Name (e.g., SUPPORTED_Windows10), Value: PSCustomObject (with RawDisplayName)
$admxNamespaces = @{} # Key: File Path, Value: Hashtable (Prefix Map for this file)

$admxFiles = Get-ChildItem -Path $AdmxBasePath -Filter *.admx -File -Recurse # Recurse might be needed depending on structure

if ($admxFiles.Count -eq 0) {
    Write-Error "No ADMX files found in '$AdmxBasePath'."
    exit 1
}

foreach ($admxFile in $admxFiles) {
    Write-Verbose "Processing ADMX: $($admxFile.FullName)"
    try {
        [xml]$admxXml = Get-Content -Path $admxFile.FullName -ErrorAction Stop

        # Get Namespaces for this file
        $nsPrefixMap = Get-NamespacePrefixMap -PolicyDefinitionsNode $admxXml.policyDefinitions
        $admxNamespaces[$admxFile.FullName] = $nsPrefixMap
        $targetNamespaceUri = $admxXml.policyDefinitions.policyNamespaces.target.namespace

        if (-not $targetNamespaceUri) {
            Write-Warning "Could not determine target namespace for '$($admxFile.Name)'. Skipping."
            continue
        }

        # SupportedOn Definitions
        $admxXml.policyDefinitions.supportedOn.definitions.definition | ForEach-Object {
            $defName = $_.name
            if ([string]::IsNullOrWhiteSpace($defName)) {
                Write-Warning "Skipping supportedOn definition in '$($admxFile.Name)' because its 'name' attribute is missing or empty."
                return # Skips current iteration of ForEach-Object
            }
            if (-not $admxSupportedOnDefinitions.ContainsKey($defName)) {
                 $admxSupportedOnDefinitions[$defName] = [PSCustomObject]@{
                     Name = $defName
                     RawDisplayName = $_.displayName # This is likely a $(string.XYZ)
                 }
            }
        }

        # Categories
        $admxXml.policyDefinitions.categories.category | ForEach-Object {
            $catName = $_.name
            if ([string]::IsNullOrWhiteSpace($catName)) {
                Write-Warning "Skipping category in '$($admxFile.Name)' because its 'name' attribute is missing or empty."
                return # Skips current iteration of ForEach-Object
            }
            $catUniqueId = "$($targetNamespaceUri)::$($catName)"
            if ($allCategories.ContainsKey($catUniqueId)) {
                Write-Warning "Duplicate category definition found for '$catUniqueId' in file '$($admxFile.Name)'. Overwriting."
            }

            $parentRefRaw = $_.parentCategory.ref
            $parentUniqueId = $null
            if ($parentRefRaw) {
                # Resolve the parent ref using this file's namespace map
                $parentUniqueId = Resolve-PrefixedName -PrefixedName $parentRefRaw -NamespacePrefixMap $nsPrefixMap -DefaultNamespaceUri $targetNamespaceUri
            }

            $allCategories[$catUniqueId] = [PSCustomObject]@{
                AdmxFile = $admxFile.Name
                UniqueId = $catUniqueId # NamespaceUri::Name
                Name = $catName
                NamespaceUri = $targetNamespaceUri
                RawDisplayName = $_.displayName # $(string.XYZ)
                ParentRefUniqueId = $parentUniqueId # Resolved Unique ID of parent
                TempNode = $_ # Keep node for later reference if needed
                # Placeholders to be filled after all parsing
                ChildrenIds = [System.Collections.Generic.List[string]]::new()
                PolicyIds = [System.Collections.Generic.List[string]]::new()
                ParentId = $null # Will be set during hierarchy resolution
            }
        }

        # Policies
        $admxXml.policyDefinitions.policies.policy | ForEach-Object {
            $polName = $_.name
            if ([string]::IsNullOrWhiteSpace($polName)) {
                Write-Warning "Skipping policy in '$($admxFile.Name)' because its 'name' attribute is missing or empty."
                return # Skips current iteration of ForEach-Object
            }
            $polUniqueId = "$($targetNamespaceUri)::$($polName)"
            if ($allPolicies.ContainsKey($polUniqueId)) {
                 Write-Warning "Duplicate policy definition found for '$polUniqueId' in file '$($admxFile.Name)'. Overwriting."
            }

            $parentCatRefRaw = $_.parentCategory.ref
             if (-not $parentCatRefRaw) {
                 Write-Warning "Policy '$polUniqueId' is missing parentCategory reference in '$($admxFile.Name)'. Skipping policy association."

             }

             $policyData = [PSCustomObject]@{
                AdmxFile = $admxFile.Name
                UniqueId = $polUniqueId # NamespaceUri::Name
                Name = $polName
                NamespaceUri = $targetNamespaceUri
                Class = $_.class
                RawDisplayName = $_.displayName
                RawExplainText = $_.explainText
                RawSupportedOn = Process-SupportedOn -PolicyNode $_ -AdmxSupportedOnDefinitions $admxSupportedOnDefinitions # May return $(string.XYZ)
                PresentationRefRaw = $_.presentation # $(presentation.XYZ)
                ParentCategoryRefRaw = $parentCatRefRaw # Keep raw ref for now
                TempNode = $_ # Keep raw node for registry processing later
                # Placeholders
                CategoryId = $null # Will be set during policy association
            }
            $allPolicies[$polUniqueId] = $policyData
        }

        # Presentations (store raw XML node for now)
         $admxXml.policyDefinitions.resources.presentationTable.presentation | ForEach-Object {
            $presId = $_.id
            if ([string]::IsNullOrWhiteSpace($presId)) {
                Write-Warning "Skipping presentation in '$($admxFile.Name)' because its 'id' attribute is missing or empty."
                return # Skips current iteration of ForEach-Object
            }
            $presUniqueId = "$($targetNamespaceUri)::$($presId)" # Associate with the ADMX namespace
             if ($allPresentations.ContainsKey($presUniqueId)) {
                 Write-Warning "Duplicate presentation definition found for '$presUniqueId' in file '$($admxFile.Name)'. Overwriting."
             }
            $allPresentations[$presUniqueId] = $_ # Store the raw XML node
         }

    } catch {
        Write-Error "Error processing ADMX file '$($admxFile.FullName)': $($_.Exception.Message)"
        Write-Host $_.Exception.StackTrace # For debugging
    }
}
Write-Host "Step 1: Finished parsing $($admxFiles.Count) ADMX files."
Write-Host " Found $($allCategories.Count) categories, $($allPolicies.Count) policies, $($allPresentations.Count) presentations."

# --- Step 2: Resolve Category Hierarchy and Associate Policies ---
Write-Host "Step 2: Resolving category hierarchy and associating policies..."

# Build Children lists and set ParentId
foreach ($catUniqueId in $allCategories.Keys) {
    $category = $allCategories[$catUniqueId]
    $parentUniqueId = $category.ParentRefUniqueId
    if ($parentUniqueId -and $allCategories.ContainsKey($parentUniqueId)) {
        $allCategories[$parentUniqueId].ChildrenIds.Add($category.UniqueId) # Add child ID to parent
        $category.ParentId = $parentUniqueId # Set parent ID on child
    } elseif ($parentUniqueId) {
         Write-Verbose "Parent category reference '$parentUniqueId' for category '$catUniqueId' not found. Treating as top-level."
         # It becomes a top-level category (ParentId remains null)
    }
    # Else: No parent ref, already a top-level category (ParentId is null)
}

# Associate Policies with Categories
foreach ($polUniqueId in $allPolicies.Keys) {
    $policy = $allPolicies[$polUniqueId]
    $parentCatRefRaw = $policy.ParentCategoryRefRaw
    if ($parentCatRefRaw) {
        # Resolve the category ref using the policy's namespace context
        $policyAdmxPath = $allPolicies[$polUniqueId].AdmxFile # Need full path? Assume name is enough if unique in base dir
        $policyNsPrefixMap = $admxNamespaces.GetEnumerator() | Where-Object {$_.Name -like "*\$($policy.AdmxFile)"} | Select -First 1 -ExpandProperty Value # Find map by file name (adjust if needed)

        if ($policyNsPrefixMap) {
             $parentCatUniqueId = Resolve-PrefixedName -PrefixedName $parentCatRefRaw -NamespacePrefixMap $policyNsPrefixMap -DefaultNamespaceUri $policy.NamespaceUri
             if ($allCategories.ContainsKey($parentCatUniqueId)) {
                 $allCategories[$parentCatUniqueId].PolicyIds.Add($policy.UniqueId) # Add policy ID to category
                 $policy.CategoryId = $parentCatUniqueId # Set category ID on policy
             } else {
                  Write-Warning "Could not find parent category '$parentCatUniqueId' (resolved from '$parentCatRefRaw') for policy '$polUniqueId'."
             }
        } else {
             Write-Warning "Could not find namespace map for policy '$polUniqueId' in file '$($policy.AdmxFile)'. Cannot resolve parent category '$parentCatRefRaw'."
        }
    }
    # Else: Policy has no parent category ref (already warned during parsing)
}

Write-Host "Step 2: Finished hierarchy resolution and policy association."


# --- Step 3: Generate JSON for each language ---
Write-Host "Step 3: Generating JSON output for each language..."

foreach ($lang in $Languages) {
    Write-Host " Processing language: $lang"
    $langFolderPath = Join-Path $AdmxBasePath $lang
    if (-not (Test-Path $langFolderPath -PathType Container)) {
        Write-Warning " Language folder not found: $langFolderPath. Skipping language '$lang'."
        continue
    }

    # Collect all strings and presentation definitions for this language
    $allLangStrings = @{}
    $allLangPresentations = @{} # Key: Presentation Unique ID (Namespace::ID), Value: Parsed PSCustomObject

    $admlFiles = Get-ChildItem -Path $langFolderPath -Filter *.adml -File
    if ($admlFiles.Count -eq 0) {
        Write-Warning "No ADML files found in '$langFolderPath'. Skipping language '$lang'."
        continue
    }

    foreach ($admlFile in $admlFiles) {
        Write-Verbose "  Processing ADML: $($admlFile.FullName)"
        try {
            [xml]$admlXml = Get-Content -Path $admlFile.FullName -Encoding UTF8 -ErrorAction Stop # Use UTF8 for ADML

            # Determine the namespace this ADML corresponds to (usually matches ADMX filename)
             $admxFileName = $admlFile.BaseName + ".admx" # Assumes ADML name matches ADMX name
             # Find the namespace URI associated with this ADMX file
             $admlNamespaceUri = $null
             $matchingAdmxEntry = $admxNamespaces.GetEnumerator() | Where-Object { $_.Name -like "*\$admxFileName"} | Select-Object -First 1
             if ($matchingAdmxEntry) {
                # Extract target namespace from the map if possible
                 $nsUriFromMap = $matchingAdmxEntry.Value.GetEnumerator() | Where-Object {$_.Key -eq ($matchingAdmxEntry.Value | Select -ExpandProperty Keys | Where-Object {$_ -ne ''} | Select -First 1)} # Heuristic: get target NS URI
                 $admlNamespaceUri = $nsUriFromMap # Simplified assumption
             }

             if (-not $admlNamespaceUri) {
                 # Fallback: Try to guess from a known ADMX like 'Windows.admx' if filename matches? Risky.
                 Write-Warning "Could not reliably determine namespace for ADML '$($admlFile.Name)'. Presentation IDs might not resolve correctly."
                 # Use a placeholder or skip presentations from this file?
                 # For strings, namespace might not matter if IDs are unique globally.
             }


            # Strings
            $admlXml.policyDefinitionResources.resources.stringTable.string | ForEach-Object {
                # ADML string IDs are generally unique across all files for a language
                if ($allLangStrings.ContainsKey($_.id)) {
                    # This *shouldn't* happen with standard MS ADMX/L files, but could with custom ones.
                    Write-Warning "Duplicate string ID '$($_.id)' found in '$($admlFile.Name)'. Previous value will be overwritten."
                }
                $allLangStrings[$_.id] = $_.'#text'
            }

            # Presentations (Resolve strings within them now)
            $admlXml.policyDefinitionResources.resources.presentationTable.presentation | ForEach-Object {
                $presId = $_.id
                 # Assume presentation belongs to the namespace of the corresponding ADMX file
                 $presUniqueId = "$($admlNamespaceUri)::$($presId)" # Combine guessed namespace and ID

                 if (-not $admlNamespaceUri) {
                     Write-Warning "Skipping presentation '$presId' from '$($admlFile.Name)' due to unknown namespace."
                     continue
                 }

                if ($allLangPresentations.ContainsKey($presUniqueId)) {
                     Write-Warning "Duplicate presentation definition '$presUniqueId' found while processing '$($admlFile.Name)'. Overwriting."
                }
                # Parse the presentation node using the helper, resolving its internal strings
                $allLangPresentations[$presUniqueId] = Parse-PresentationNode -Node $_ -StringTable $allLangStrings
            }
        } catch {
             Write-Error "Error processing ADML file '$($admlFile.FullName)': $($_.Exception.Message)"
             Write-Host $_.Exception.StackTrace # For debugging
        }
    }
     Write-Verbose "  Collected $($allLangStrings.Count) strings and $($allLangPresentations.Count) resolved presentations for $lang."

    # --- Build the final flat data structure for this language ---
    $resolvedCategories = [System.Collections.Generic.List[object]]::new()
    foreach ($catKey in $allCategories.Keys) {
        $catData = $allCategories[$catKey]
        $resolvedCat = [PSCustomObject]@{
            id = $catData.UniqueId # Use the unique ID
            name = $catData.Name
            displayName = Resolve-String -RawString $catData.RawDisplayName -StringTable $allLangStrings -DefaultValue $catData.Name
            parent = $catData.ParentId # Reference to parent's UniqueId (or null)
            children = $catData.ChildrenIds # List of child UniqueIds
            policies = $catData.PolicyIds   # List of policy UniqueIds in this category
            # Add namespace for context if needed by frontend?
            # namespace = $catData.NamespaceUri
        }
        $resolvedCategories.Add($resolvedCat)
    }

    $resolvedPolicies = [System.Collections.Generic.List[object]]::new()
    foreach ($polKey in $allPolicies.Keys) {
        $polData = $allPolicies[$polKey]
        $resolvedPolicy = [PSCustomObject]@{
            id = $polData.UniqueId # Use the unique ID
            name = $polData.Name
            class = $polData.Class
            displayName = Resolve-String -RawString $polData.RawDisplayName -StringTable $allLangStrings -DefaultValue $polData.Name
            explainText = Resolve-String -RawString $polData.RawExplainText -StringTable $allLangStrings -DefaultValue "No description."
            supportedOn = Resolve-String -RawString $polData.RawSupportedOn -StringTable $allLangStrings -DefaultValue "Not specified"
            categoryId = $polData.CategoryId # Reference to category's UniqueId
            registry = $null # Placeholder
            presentation = $null # Placeholder
            admxFile = $polData.AdmxFile # File where the policy is defined
            # Add namespace for context if needed?
            # namespace = $polData.NamespaceUri
        }

        # Process Registry Info (using the stored TempNode)
        $resolvedPolicy.registry = Process-RegistryInfo -PolicyNode $polData.TempNode -StringTable $allLangStrings

        # Process Presentation Info
        if ($polData.PresentationRefRaw -match '^\$\(presentation\.(.+)\)$') {
            $presentationId = $Matches[1]
            # Presentation IDs are relative to the policy's namespace
            $presentationUniqueId = "$($polData.NamespaceUri)::$($presentationId)"
            if ($allLangPresentations.ContainsKey($presentationUniqueId)) {
                $resolvedPolicy.presentation = $allLangPresentations[$presentationUniqueId] # Assign the parsed presentation object
            } else {
                 Write-Verbose "Presentation reference '$presentationUniqueId' for policy '$($resolvedPolicy.id)' not found in language '$lang'."
            }
        }

         # Cleanup null presentation property if not found/resolved
        if($null -eq $resolvedPolicy.presentation) {
            $resolvedPolicy.PSObject.Properties.Remove('presentation')
        }
         # Cleanup null registry property if processing failed or not applicable
        if($null -eq $resolvedPolicy.registry) {
            $resolvedPolicy.PSObject.Properties.Remove('registry')
        }


        $resolvedPolicies.Add($resolvedPolicy)
    }

    # Add a virtual root category for the frontend tree structure
     $rootChildrenIds = $resolvedCategories | Where-Object { -not $_.parent } | Select-Object -ExpandProperty id
     $virtualRoot = [PSCustomObject]@{
        id = 'ROOT'
        name = 'ROOT'
        displayName = (Resolve-String -RawString '$(string.VirtualRootDisplayName)' -StringTable $allLangStrings -DefaultValue 'Administrative Templates') # Allow override via ADML string
        parent = $null
        children = $rootChildrenIds
        policies = @()
    }

    # Final JSON structure for this language
    $jsonData = [PSCustomObject]@{
        language = $lang
        allCategories = @($virtualRoot) + $resolvedCategories # Combine root and others
        allPolicies = $resolvedPolicies
    }

    # Convert to JSON and save
    $outputFileName = "data_$($lang.Replace('-','_')).json" # e.g., data_en_US.json
    $outputFilePath = Join-Path $OutputPath $outputFileName
    try {
        ConvertTo-Json -InputObject $jsonData -Depth $Depth | Out-File -FilePath $outputFilePath -Encoding UTF8 -ErrorAction Stop
        Write-Host "  Successfully generated JSON file: $outputFilePath"
    } catch {
        Write-Error "Failed to write JSON file '$outputFilePath': $($_.Exception.Message)"
    }

} # End language loop

Write-Host "Step 3: Finished generating JSON files."
Write-Host "Script completed."