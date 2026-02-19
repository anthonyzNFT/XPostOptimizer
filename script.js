let pyodide;
let chart;

async function loadPyodideAndPackages() {
    pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/"
    });
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install("textblob");
    // Define the Python simulation function (heuristic proxy for Phoenix transformer and home-mixer scoring)
    // Based on repo: Predicts probs for 10 actions via learned-like heuristics (text analysis proxies embeddings).
    // Candidate isolation: Treats post independently. Focuses on media signals (+ to positives), originality (unique words ratio, + to positives/- to negatives),
    // engagement velocity (short/question boosts positives), user context matching.
    // Weighted score: sum(prob * weight). Clips probs to [0,1].
    const pythonCode = `
import re
from textblob import TextBlob

def simulate(post_text, has_media, is_reply, premium_plus, user_context):
    if not post_text:
        probs = {action: 0.0 for action in weights}
        score = 0.0
        feedback = ['Please enter some post text.']
        return {'probs': probs, 'score': score, 'feedback': feedback}
    
    length = len(post_text)
    sentiment = TextBlob(post_text).sentiment.polarity
    words = re.findall(r'\\w+', post_text.lower())
    total_words = len(words)
    originality = len(set(words)) / total_words if total_words else 0.0
    has_question = '?' in post_text
    has_nft = bool(re.search(r'#NFT', post_text, re.I))
    has_crypto = bool(re.search(r'#Crypto', post_text, re.I))
    
    base_pos = 0.3
    base_neg = 0.1
    sentiment_adj = 0.2 * sentiment
    length_adj = -0.1 if length > 280 else 0.05 if length < 100 else 0.0  # Short/punchy for velocity
    media_adj = 0.2 if has_media else 0.0  # Media signal boost per repo
    reply_adj = 0.1 if is_reply else 0.0
    premium_adj = 0.1 if premium_plus else 0.0
    context_adj = 0.1 if (user_context == 'NFT Enthusiast' and has_nft) or (user_context == 'Crypto' and has_crypto) else 0.0
    question_adj = 0.15 if has_question else 0.0  # For reply velocity
    originality_adj = 0.1 * originality
    
    neg_adj = -sentiment_adj  # Negative sentiment boosts negatives
    long_adj_neg = 0.1 if length > 280 else 0.0  # Long increases blocks per example
    originality_adj_neg = -0.1 * (1 - originality)  # Low originality boosts negatives
    
    probs = {
        'like': max(0, min(1, base_pos + sentiment_adj + media_adj + premium_adj + context_adj + originality_adj + length_adj)),
        'reply': max(0, min(1, base_pos + question_adj + reply_adj + sentiment_adj + context_adj + length_adj)),
        'repost': max(0, min(1, base_pos + media_adj + context_adj + originality_adj + length_adj)),
        'quote': max(0, min(1, base_pos + sentiment_adj + context_adj + originality_adj + length_adj)),
        'click': max(0, min(1, base_pos + media_adj + length_adj)),
        'dwell': max(0, min(1, base_pos + length_adj + originality_adj)),  # Original content encourages dwell
        'follow_author': max(0, min(1, base_pos + premium_adj + context_adj)),
        'not_interested': max(0, min(1, base_neg + neg_adj + long_adj_neg + originality_adj_neg)),
        'block': max(0, min(1, base_neg + 0.05 + neg_adj + long_adj_neg + originality_adj_neg)),
        'report': max(0, min(1, base_neg + 0.1 + neg_adj + long_adj_neg + originality_adj_neg))
    }
    
    weights = {
        'like': 1.5, 'reply': 1.2, 'repost': 1.8, 'quote': 1.0, 'click': 0.8,
        'dwell': 1.0, 'follow_author': 2.0, 'not_interested': -1.5, 'block': -2.0, 'report': -3.0
    }
    
    score = sum(probs[action] * weights[action] for action in probs)
    
    feedback = []
    if length > 280:
        feedback.append('Post is over 280 characters; shorten for better engagement velocity.')
    if sentiment < 0:
        feedback.append('Negative sentiment detected; positive tones increase likes/reposts.')
    if not has_media:
        feedback.append('Add media to boost likes, reposts, and clicks.')
    if not has_question:
        feedback.append('Include a question to encourage replies.')
    if originality < 0.7:
        feedback.append('Increase originality (unique words) to reduce negative engagements.')
    if user_context in ['NFT Enthusiast', 'Crypto'] and not (has_nft or has_crypto):
        feedback.append('Add relevant hashtags like #NFT or #Crypto to match your audience context.')
    
    return {'probs': probs, 'score': score, 'feedback': feedback}
    `;
    await pyodide.runPythonAsync(pythonCode);
}

async function simulate() {
    const postText = document.getElementById('post-text').value;
    const hasMedia = document.getElementById('has-media').checked;
    const isReply = document.getElementById('is-reply').checked;
    const premiumPlus = document.getElementById('premium-plus').checked;
    const userContext = document.getElementById('user-context').value;
    
    const result = await pyodide.runPythonAsync(
        `simulate(${JSON.stringify(postText)}, ${hasMedia}, ${isReply}, ${premiumPlus}, ${JSON.stringify(userContext)})`
    );
    const jsResult = result.toJs({ dict_converter: Object.fromEntries });
    
    // Update score badge
    const scoreBadge = document.getElementById('score-badge');
    let badgeClass = 'bad';
    if (jsResult.score > 4) badgeClass = 'good';
    else if (jsResult.score > 1) badgeClass = 'medium';
    scoreBadge.className = `badge ${badgeClass}`;
    scoreBadge.textContent = `Overall Score: ${jsResult.score.toFixed(2)}`;
    
    // Update feedback
    const feedbackList = document.getElementById('feedback-list');
    feedbackList.innerHTML = '';
    jsResult.feedback.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        feedbackList.appendChild(li);
    });
    
    // Update chart
    const actions = Object.keys(jsResult.probs);
    const values = Object.values(jsResult.probs);
    const positiveActions = ['like', 'reply', 'repost', 'quote', 'click', 'dwell', 'follow_author'];
    const colors = actions.map(action => positiveActions.includes(action) ? 'rgba(0, 255, 0, 0.6)' : 'rgba(255, 0, 0, 0.6)');
    
    const ctx = document.getElementById('chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: actions,
            datasets: [{
                label: 'Probability',
                data: values,
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace(0.6, 1)),
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, max: 1, ticks: { color: '#e0e0e0' }, grid: { color: '#444' } },
                x: { ticks: { color: '#e0e0e0' }, grid: { color: '#444' } }
            },
            plugins: { legend: { labels: { color: '#e0e0e0' } } },
            responsive: true
        }
    });
}

let debounceTimeout;
function debounceSimulate() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(simulate, 500);
}

async function init() {
    await loadPyodideAndPackages();
    // Add event listeners for real-time updates
    document.getElementById('post-text').addEventListener('input', debounceSimulate);
    document.getElementById('has-media').addEventListener('change', debounceSimulate);
    document.getElementById('is-reply').addEventListener('change', debounceSimulate);
    document.getElementById('premium-plus').addEventListener('change', debounceSimulate);
    document.getElementById('user-context').addEventListener('change', debounceSimulate);
    // Initial simulation
    simulate();
}

init();
