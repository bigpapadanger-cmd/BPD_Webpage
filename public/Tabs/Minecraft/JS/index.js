import { 
    renderHeader 
} from "/Framework/Shell/JS/renderHeader.js"; 
 
const minecraftPanels = 
    document.querySelectorAll( 
        "[data-minecraft-panel]" 
    ); 
 
renderHeader({ 
    eyebrow: "BPD GAMING NETWORK", 
 
    title: "Minecraft", 
 
    tabs: [ 
        { 
            label: "Mods" 
        }, 
        { 
            label: "Announcements" 
        } 
    ] 
}); 
 
 
function renderMinecraftPanel() { 
 
    const params = 
        new URLSearchParams( 
            window.location.search 
        ); 
 
    const tab = 
        params.get("tab") || 
        "mods"; 
 
 
    minecraftPanels.forEach( 
        panel => { 
 
            panel.hidden = 
                panel.dataset.minecraftPanel !== tab; 
 
        } 
    ); 
 
} 
 
 
renderMinecraftPanel(); 
 
window.addEventListener( 
    "popstate", 
    renderMinecraftPanel 
);