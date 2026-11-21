import ReactDOM from "react-dom/client";
import VrmOverlay from "./VrmOverlay.jsx";
import "./overlay.css";

// No index.css here: the overlay must stay transparent, and that stylesheet
// paints the body.
ReactDOM.createRoot(document.getElementById("root")).render(<VrmOverlay />);
