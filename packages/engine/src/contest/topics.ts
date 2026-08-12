/**
 * The Tiers topic bank.
 *
 * Canned items are listed in rough descending popularity. That order is what
 * bots play from — a bot's list is a lightly perturbed popularity order, which
 * keeps bots guessable by attentive humans and keeps bot-vs-bot games from
 * going inert. Humans are free to ignore the canned items entirely.
 */

import { substream } from '../rng.js';

export interface TiersTopic {
  title: string;
  canned: string[];
}

// prettier-ignore
export const TIERS_TOPICS: readonly TiersTopic[] = [
  { title: 'Fast food chains', canned: ["McDonald's", 'Chick-fil-A', "Wendy's", 'Taco Bell', 'Burger King', 'Subway', 'KFC', "Arby's"] },
  { title: 'Pizza toppings', canned: ['Pepperoni', 'Mushrooms', 'Sausage', 'Extra cheese', 'Onions', 'Bacon', 'Pineapple', 'Anchovies'] },
  { title: 'Dog breeds', canned: ['Labrador', 'Golden Retriever', 'German Shepherd', 'Poodle', 'Beagle', 'Corgi', 'Dachshund', 'Chihuahua'] },
  { title: 'Superpowers', canned: ['Flight', 'Teleportation', 'Time travel', 'Invisibility', 'Super strength', 'Mind reading', 'Healing', 'X-ray vision'] },
  { title: 'Breakfast cereals', canned: ['Cinnamon Toast Crunch', 'Frosted Flakes', 'Lucky Charms', 'Cheerios', 'Froot Loops', 'Rice Krispies', 'Corn Flakes', 'Raisin Bran'] },
  { title: 'Ice cream flavors', canned: ['Chocolate', 'Cookies and cream', 'Vanilla', 'Mint chip', 'Strawberry', 'Cookie dough', 'Pistachio', 'Rum raisin'] },
  { title: 'Board games', canned: ['Chess', 'Catan', 'Scrabble', 'Monopoly', 'Risk', 'Clue', 'Checkers', 'Candy Land'] },
  { title: 'Sodas', canned: ['Coca-Cola', 'Dr Pepper', 'Sprite', 'Pepsi', 'Mountain Dew', 'Root beer', 'Fanta', 'Tab'] },
  { title: 'Candy', canned: ["Reese's", 'Kit Kat', 'Snickers', "M&M's", 'Twix', 'Skittles', 'Candy corn', 'Black licorice'] },
  { title: 'Fruits', canned: ['Strawberry', 'Mango', 'Watermelon', 'Apple', 'Banana', 'Pineapple', 'Grapefruit', 'Durian'] },
  { title: 'Vegetables', canned: ['Corn', 'Potatoes', 'Carrots', 'Broccoli', 'Spinach', 'Cauliflower', 'Brussels sprouts', 'Okra'] },
  { title: 'Household chores', canned: ['Cooking', 'Laundry', 'Vacuuming', 'Dishes', 'Dusting', 'Mowing the lawn', 'Cleaning the bathroom', 'Unclogging drains'] },
  { title: 'Kinds of weather', canned: ['Sunny and mild', 'Snow day', 'Light rain', 'Thunderstorm', 'Fog', 'Windy', 'Hail', 'Heat wave'] },
  { title: 'Holidays', canned: ['Christmas', 'Halloween', 'Thanksgiving', "New Year's Eve", 'Fourth of July', 'Easter', "Valentine's Day", 'Tax Day'] },
  { title: 'Movie genres', canned: ['Comedy', 'Action', 'Thriller', 'Sci-fi', 'Horror', 'Romance', 'Documentary', 'Musical'] },
  { title: 'Music genres', canned: ['Rock', 'Pop', 'Hip hop', 'Country', 'Jazz', 'Classical', 'Metal', 'Polka'] },
  { title: 'Pets', canned: ['Dog', 'Cat', 'Fish', 'Rabbit', 'Hamster', 'Parrot', 'Snake', 'Tarantula'] },
  { title: 'Sandwiches', canned: ['Grilled cheese', 'Turkey club', 'BLT', 'Peanut butter and jelly', 'Ham and cheese', 'Tuna salad', 'Egg salad', 'Liverwurst'] },
  { title: 'Condiments', canned: ['Ketchup', 'Ranch', 'Mayonnaise', 'Mustard', 'BBQ sauce', 'Hot sauce', 'Relish', 'Miracle Whip'] },
  { title: 'School subjects', canned: ['Gym', 'Art', 'Science', 'History', 'Math', 'English', 'Chemistry', 'Latin'] },
  { title: 'Ways to travel', canned: ['Airplane', 'Train', 'Road trip', 'Boat', 'Bicycle', 'Motorcycle', 'Bus', 'Walking'] },
  { title: 'Vacations', canned: ['Beach resort', 'Mountain cabin', 'Big city trip', 'National park', 'Cruise', 'Theme park', 'Camping', 'Visiting relatives'] },
  { title: 'Mythical creatures', canned: ['Dragon', 'Phoenix', 'Unicorn', 'Mermaid', 'Griffin', 'Werewolf', 'Kraken', 'Goblin'] },
  { title: 'Video game genres', canned: ['RPG', 'Shooter', 'Platformer', 'Strategy', 'Puzzle', 'Racing', 'Fighting', 'Sports'] },
  { title: 'Card games', canned: ['Poker', 'Uno', 'Blackjack', 'Solitaire', 'Hearts', 'Go Fish', 'Rummy', 'War'] },
  { title: 'Coffee orders', canned: ['Latte', 'Cold brew', 'Cappuccino', 'Mocha', 'Black coffee', 'Espresso', 'Frappuccino', 'Decaf'] },
  { title: 'Desserts', canned: ['Chocolate cake', 'Cheesecake', 'Brownies', 'Apple pie', 'Tiramisu', 'Ice cream sundae', 'Donuts', 'Fruitcake'] },
  { title: 'Snacks', canned: ['Potato chips', 'Popcorn', 'Pretzels', 'Trail mix', 'Crackers', 'Beef jerky', 'Rice cakes', 'Plain celery'] },
  { title: 'Ways to exercise', canned: ['Walking', 'Swimming', 'Weightlifting', 'Yoga', 'Running', 'Cycling', 'Rowing', 'Burpees'] },
  { title: 'Pasta shapes', canned: ['Spaghetti', 'Penne', 'Fettuccine', 'Elbow macaroni', 'Ravioli', 'Lasagna', 'Angel hair', 'Orzo'] },
  { title: 'Cheeses', canned: ['Cheddar', 'Mozzarella', 'Parmesan', 'Swiss', 'Brie', 'Gouda', 'Feta', 'Limburger'] },
  { title: 'Pies', canned: ['Apple', 'Pumpkin', 'Pecan', 'Cherry', 'Key lime', 'Lemon meringue', 'Blueberry', 'Mincemeat'] },
  { title: 'Kitchen appliances', canned: ['Microwave', 'Air fryer', 'Coffee maker', 'Dishwasher', 'Blender', 'Toaster', 'Slow cooker', 'Bread machine'] },
  { title: 'Smells', canned: ['Fresh bread', 'Coffee', 'Rain on pavement', 'Campfire', 'Fresh-cut grass', 'Vanilla', 'Gasoline', 'Wet dog'] },
  { title: 'Gadgets', canned: ['Smartphone', 'Laptop', 'Headphones', 'Smart watch', 'Tablet', 'E-reader', 'Drone', 'Fax machine'] },
  { title: 'Social media platforms', canned: ['YouTube', 'Instagram', 'TikTok', 'Reddit', 'Twitter', 'Facebook', 'Snapchat', 'LinkedIn'] },
  { title: 'Ocean animals', canned: ['Dolphin', 'Sea turtle', 'Octopus', 'Whale', 'Seahorse', 'Shark', 'Crab', 'Jellyfish'] },
  { title: 'Birds', canned: ['Eagle', 'Owl', 'Penguin', 'Hummingbird', 'Parrot', 'Flamingo', 'Crow', 'Pigeon'] },
  { title: 'Sports to watch', canned: ['Football', 'Basketball', 'Baseball', 'Soccer', 'Hockey', 'Tennis', 'Golf', 'Bowling'] },
  { title: 'Things on toast', canned: ['Butter', 'Avocado', 'Jam', 'Peanut butter', 'Nutella', 'Honey', 'Cream cheese', 'Marmite'] },
  { title: 'Breakfast foods', canned: ['Pancakes', 'Bacon', 'Waffles', 'French toast', 'Omelet', 'Hash browns', 'Oatmeal', 'Grapefruit half'] },
  { title: 'Soups', canned: ['Chicken noodle', 'Tomato', 'Clam chowder', 'Broccoli cheddar', 'French onion', 'Minestrone', 'Split pea', 'Gazpacho'] },
  { title: 'Salad dressings', canned: ['Ranch', 'Caesar', 'Italian', 'Balsamic vinaigrette', 'Honey mustard', 'Thousand Island', 'Blue cheese', 'Plain oil'] },
  { title: 'Fast food sides', canned: ['French fries', 'Onion rings', 'Mozzarella sticks', 'Tater tots', 'Curly fries', 'Coleslaw', 'Side salad', 'Steamed broccoli'] },
  { title: 'Juices', canned: ['Orange', 'Lemonade', 'Apple', 'Cranberry', 'Grape', 'Pineapple', 'Tomato', 'Prune'] },
  { title: 'Musical instruments', canned: ['Guitar', 'Piano', 'Drums', 'Violin', 'Saxophone', 'Trumpet', 'Ukulele', 'Bagpipes'] },
  { title: 'Theme park rides', canned: ['Roller coaster', 'Log flume', 'Haunted house', 'Ferris wheel', 'Bumper cars', 'Carousel', 'Teacups', "It's a Small World"] },
  { title: 'Winter activities', canned: ['Sledding', 'Ice skating', 'Skiing', 'Snowball fight', 'Building a snowman', 'Snowshoeing', 'Winter hiking', 'Shoveling the driveway'] },
  { title: 'Halloween costumes', canned: ['Vampire', 'Witch', 'Superhero', 'Ghost', 'Pirate', 'Zombie', 'Black cat', 'Cardboard robot'] },
  { title: 'Dinosaurs', canned: ['T. rex', 'Velociraptor', 'Triceratops', 'Stegosaurus', 'Brachiosaurus', 'Pterodactyl', 'Ankylosaurus', 'Compsognathus'] },
  { title: 'Planets', canned: ['Saturn', 'Earth', 'Mars', 'Jupiter', 'Neptune', 'Venus', 'Mercury', 'Pluto'] },
  { title: 'Colors', canned: ['Blue', 'Green', 'Purple', 'Red', 'Teal', 'Orange', 'Yellow', 'Beige'] },
];

/**
 * The topic for the list written alongside turn `writeTurn`'s orders
 * (`writeTurn` 0 is the lobby list). One seeded shuffle of the whole bank per
 * game, walked in order: deterministic, and repeat-free until the bank cycles.
 * The bank must stay larger than MAX_TURN_CAP so no game ever repeats a topic
 * (writeTurns 0..cap need cap+1 distinct topics) — pinned by topics.test.ts.
 */
export function topicForTurn(seed: string, writeTurn: number): TiersTopic {
  const shuffled = substream(seed, 'tiers-topics').shuffle(TIERS_TOPICS);
  return shuffled[writeTurn % shuffled.length];
}
